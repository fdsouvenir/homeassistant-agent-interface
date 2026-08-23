import { InterfaceError } from "./errors.js";
import type { PluginConfig, WebSocketCommand } from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

type SocketLike = Pick<
  WebSocket,
  "addEventListener" | "removeEventListener" | "send" | "close" | "binaryType"
>;

type SocketFactory = (url: string) => SocketLike;

export type CommandOutcome =
  { ok: true; value: unknown } | { ok: false; error: InterfaceError };

function configuredWebSocketUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch (error) {
    throw new InterfaceError(
      "CONFIG_REQUIRED",
      "Configure a valid Home Assistant baseUrl.",
      {
        recovery: { action: "configure_plugin", fields: ["baseUrl"] },
        cause: error,
      },
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new InterfaceError(
      "CONFIG_REQUIRED",
      "Home Assistant baseUrl must use HTTP or HTTPS.",
      { recovery: { action: "configure_plugin", fields: ["baseUrl"] } },
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new InterfaceError(
      "CONFIG_REQUIRED",
      "Home Assistant baseUrl cannot contain credentials, a query, or a fragment.",
      { recovery: { action: "configure_plugin", fields: ["baseUrl"] } },
    );
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  const socketUrl = new URL("api/websocket", url);
  socketUrl.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return socketUrl;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function cleanMessage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized === "" ? undefined : normalized.slice(0, 500);
}

function commandError(value: unknown): InterfaceError {
  const record = asRecord(value) ?? {};
  const code = typeof record.code === "string" ? record.code : "unknown_error";
  const detail = cleanMessage(record.message);
  if (code === "unauthorized") {
    return new InterfaceError(
      "ACCESS_DENIED",
      detail
        ? `Home Assistant denied the command: ${detail}`
        : "Home Assistant denied the command.",
    );
  }
  if (code === "not_found") {
    return new InterfaceError(
      "NOT_FOUND",
      detail
        ? `Home Assistant could not find the requested resource: ${detail}`
        : "Home Assistant could not find the requested resource.",
    );
  }
  if (code === "invalid_format") {
    return new InterfaceError(
      "INVALID_INPUT",
      detail
        ? `Home Assistant rejected the command: ${detail}`
        : "Home Assistant rejected the command parameters.",
      { recovery: { action: "narrow_request" } },
    );
  }
  return new InterfaceError(
    "UPSTREAM_UNAVAILABLE",
    detail
      ? `Home Assistant could not complete the command: ${detail}`
      : "Home Assistant could not complete the command.",
  );
}

async function messageText(
  data: unknown,
): Promise<{ text: string; bytes: number }> {
  if (typeof data === "string") {
    return { text: data, bytes: new TextEncoder().encode(data).byteLength };
  }
  if (data instanceof ArrayBuffer) {
    return { text: new TextDecoder().decode(data), bytes: data.byteLength };
  }
  if (ArrayBuffer.isView(data)) {
    const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return { text: new TextDecoder().decode(view), bytes: view.byteLength };
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    return { text: await data.text(), bytes: data.size };
  }
  throw new InterfaceError(
    "UPSTREAM_INVALID_RESPONSE",
    "Home Assistant returned an unsupported WebSocket message.",
  );
}

export class HomeAssistantWebSocketClient {
  readonly #url: URL;
  readonly #token: string;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #socketFactory: SocketFactory;

  constructor(
    config: PluginConfig,
    socketFactory: SocketFactory = (url) => new WebSocket(url),
  ) {
    if (typeof config.baseUrl !== "string" || config.baseUrl.trim() === "") {
      throw new InterfaceError(
        "CONFIG_REQUIRED",
        "Configure the Home Assistant baseUrl.",
        { recovery: { action: "configure_plugin", fields: ["baseUrl"] } },
      );
    }
    if (typeof config.token !== "string" || config.token.trim() === "") {
      throw new InterfaceError(
        "CONFIG_REQUIRED",
        "Configure a Home Assistant access token.",
        { recovery: { action: "configure_plugin", fields: ["token"] } },
      );
    }
    this.#url = configuredWebSocketUrl(config.baseUrl);
    this.#token = config.token.trim();
    this.#timeoutMs = config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxResponseBytes =
      config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.#socketFactory = socketFactory;
  }

  async runCommandsSettled(
    commands: WebSocketCommand[],
    signal?: AbortSignal,
  ): Promise<CommandOutcome[]> {
    if (commands.length === 0) return [];
    if (signal?.aborted) {
      throw new InterfaceError(
        "REQUEST_ABORTED",
        "Home Assistant request was cancelled.",
      );
    }

    return new Promise<CommandOutcome[]>((resolve, reject) => {
      let socket: SocketLike;
      try {
        socket = this.#socketFactory(this.#url.toString());
      } catch (error) {
        reject(
          new InterfaceError(
            "UPSTREAM_UNAVAILABLE",
            "Home Assistant WebSocket could not be opened.",
            { retryable: true, recovery: { action: "retry" }, cause: error },
          ),
        );
        return;
      }

      socket.binaryType = "arraybuffer";
      const outcomes: Array<CommandOutcome | undefined> = commands.map(
        () => undefined,
      );
      let receivedBytes = 0;
      let authenticated = false;
      let completed = false;

      const cleanup = () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("error", onError);
        socket.removeEventListener("close", onClose);
      };
      const close = () => {
        try {
          socket.close(1000, "complete");
        } catch {
          // The socket may already be closed by Home Assistant.
        }
      };
      const fail = (error: InterfaceError) => {
        if (completed) return;
        completed = true;
        cleanup();
        close();
        reject(error);
      };
      const finish = () => {
        if (completed || outcomes.some((outcome) => outcome === undefined)) {
          return;
        }
        completed = true;
        cleanup();
        close();
        resolve(outcomes as CommandOutcome[]);
      };
      const onAbort = () => {
        fail(
          new InterfaceError(
            "REQUEST_ABORTED",
            "Home Assistant request was cancelled.",
          ),
        );
      };
      const onError = () => {
        fail(
          new InterfaceError(
            "UPSTREAM_UNAVAILABLE",
            "Home Assistant WebSocket failed.",
            { retryable: true, recovery: { action: "retry" } },
          ),
        );
      };
      const onClose = () => {
        if (!completed) {
          fail(
            new InterfaceError(
              "UPSTREAM_UNAVAILABLE",
              "Home Assistant closed the WebSocket before completing the request.",
              { retryable: !authenticated, recovery: { action: "retry" } },
            ),
          );
        }
      };
      const handleMessage = async (event: MessageEvent) => {
        try {
          const decoded = await messageText(event.data);
          if (completed) return;
          receivedBytes += decoded.bytes;
          if (receivedBytes > this.#maxResponseBytes) {
            fail(
              new InterfaceError(
                "RESPONSE_TOO_LARGE",
                "Home Assistant response exceeded the configured byte limit.",
                { recovery: { action: "narrow_request" } },
              ),
            );
            return;
          }
          let value: unknown;
          try {
            value = JSON.parse(decoded.text) as unknown;
          } catch (error) {
            fail(
              new InterfaceError(
                "UPSTREAM_INVALID_RESPONSE",
                "Home Assistant returned invalid WebSocket JSON.",
                { cause: error },
              ),
            );
            return;
          }
          const message = asRecord(value);
          if (!message || typeof message.type !== "string") {
            fail(
              new InterfaceError(
                "UPSTREAM_INVALID_RESPONSE",
                "Home Assistant returned an invalid WebSocket message.",
              ),
            );
            return;
          }
          if (message.type === "auth_required") {
            socket.send(
              JSON.stringify({ type: "auth", access_token: this.#token }),
            );
            return;
          }
          if (message.type === "auth_invalid") {
            fail(
              new InterfaceError(
                "AUTH_FAILED",
                "Home Assistant rejected the access token.",
                {
                  recovery: { action: "configure_plugin", fields: ["token"] },
                },
              ),
            );
            return;
          }
          if (message.type === "auth_ok") {
            if (authenticated) return;
            authenticated = true;
            commands.forEach((command, index) => {
              socket.send(JSON.stringify({ ...command, id: index + 1 }));
            });
            return;
          }
          if (message.type !== "result" || !authenticated) return;
          const id = message.id;
          if (
            typeof id !== "number" ||
            !Number.isInteger(id) ||
            id < 1 ||
            id > commands.length
          ) {
            fail(
              new InterfaceError(
                "UPSTREAM_INVALID_RESPONSE",
                "Home Assistant returned an invalid command identifier.",
              ),
            );
            return;
          }
          const index = id - 1;
          if (outcomes[index] !== undefined) return;
          if (message.success === true) {
            outcomes[index] = { ok: true, value: message.result };
          } else if (message.success === false) {
            outcomes[index] = { ok: false, error: commandError(message.error) };
          } else {
            fail(
              new InterfaceError(
                "UPSTREAM_INVALID_RESPONSE",
                "Home Assistant returned an invalid command result.",
              ),
            );
            return;
          }
          finish();
        } catch (error) {
          fail(
            error instanceof InterfaceError
              ? error
              : new InterfaceError(
                  "UPSTREAM_INVALID_RESPONSE",
                  "Home Assistant returned an invalid WebSocket message.",
                  { cause: error },
                ),
          );
        }
      };
      const onMessage = (event: MessageEvent) => {
        void handleMessage(event);
      };
      const timeout = setTimeout(() => {
        fail(
          new InterfaceError(
            "UPSTREAM_TIMEOUT",
            "Home Assistant WebSocket request timed out.",
            { retryable: true, recovery: { action: "retry" } },
          ),
        );
      }, this.#timeoutMs);

      socket.addEventListener("message", onMessage);
      socket.addEventListener("error", onError);
      socket.addEventListener("close", onClose);
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }

  async runCommand(
    command: WebSocketCommand,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const [outcome] = await this.runCommandsSettled([command], signal);
    if (!outcome) {
      throw new InterfaceError(
        "UPSTREAM_INVALID_RESPONSE",
        "Home Assistant did not return a command result.",
      );
    }
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }
}
