import { describe, expect, it } from "vitest";
import {
  HomeAssistantWebSocketClient,
  type CommandOutcome,
} from "./websocket.js";

const baseConfig = {
  baseUrl: "https://ha.example.test/proxy",
  token: "test-token",
};

class FakeSocket extends EventTarget {
  binaryType: BinaryType = "blob";
  readonly sent: Record<string, unknown>[] = [];
  closed = false;
  onSend?: (message: Record<string, unknown>, socket: FakeSocket) => void;

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    const message = JSON.parse(String(data)) as Record<string, unknown>;
    this.sent.push(message);
    this.onSend?.(message, this);
  }

  close(_code?: number, _reason?: string) {
    this.closed = true;
  }

  emit(value: unknown) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(value) }),
    );
  }
}

function authenticatedFactory(
  urls: string[],
  onCommand: (message: Record<string, unknown>, socket: FakeSocket) => void,
) {
  return (url: string) => {
    urls.push(url);
    const socket = new FakeSocket();
    socket.onSend = (message) => {
      if (message.type === "auth") {
        queueMicrotask(() => socket.emit({ type: "auth_ok" }));
        return;
      }
      onCommand(message, socket);
    };
    queueMicrotask(() => socket.emit({ type: "auth_required" }));
    return socket;
  };
}

describe("HomeAssistantWebSocketClient", () => {
  it("uses the configured base path and batches authenticated commands", async () => {
    const urls: string[] = [];
    const client = new HomeAssistantWebSocketClient(
      baseConfig,
      authenticatedFactory(urls, (message, socket) => {
        queueMicrotask(() =>
          socket.emit({
            id: message.id,
            type: "result",
            success: true,
            result: message.type,
          }),
        );
      }),
    );

    const result = await client.runCommandsSettled([
      { type: "get_services" },
      { type: "config/area_registry/list" },
    ]);

    expect(urls).toEqual(["wss://ha.example.test/proxy/api/websocket"]);
    expect(result).toEqual([
      { ok: true, value: "get_services" },
      { ok: true, value: "config/area_registry/list" },
    ]);
  });

  it("returns per-command failures without discarding successful results", async () => {
    const client = new HomeAssistantWebSocketClient(
      baseConfig,
      authenticatedFactory([], (message, socket) => {
        const success = message.type === "get_services";
        queueMicrotask(() =>
          socket.emit({
            id: message.id,
            type: "result",
            success,
            ...(success
              ? { result: {} }
              : {
                  error: {
                    code: "unauthorized",
                    message: "Registry access denied",
                  },
                }),
          }),
        );
      }),
    );

    const result = await client.runCommandsSettled([
      { type: "get_services" },
      { type: "config/device_registry/list" },
    ]);

    expect(result[0]).toEqual({ ok: true, value: {} });
    expect(
      (result[1] as Extract<CommandOutcome, { ok: false }>).error,
    ).toMatchObject({ code: "ACCESS_DENIED" });
  });

  it("maps rejected action parameters to a self-correcting input error", async () => {
    const client = new HomeAssistantWebSocketClient(
      baseConfig,
      authenticatedFactory([], (message, socket) => {
        queueMicrotask(() =>
          socket.emit({
            id: message.id,
            type: "result",
            success: false,
            error: { code: "invalid_format", message: "brightness is invalid" },
          }),
        );
      }),
    );

    await expect(
      client.runCommand({ type: "call_service" }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      recovery: { action: "narrow_request" },
    });
  });

  it("rejects oversized WebSocket response streams", async () => {
    const client = new HomeAssistantWebSocketClient(
      { ...baseConfig, maxResponseBytes: 100 },
      authenticatedFactory([], (message, socket) => {
        queueMicrotask(() =>
          socket.emit({
            id: message.id,
            type: "result",
            success: true,
            result: "x".repeat(200),
          }),
        );
      }),
    );

    await expect(
      client.runCommand({ type: "get_services" }),
    ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });

  it("propagates cancellation while commands are pending", async () => {
    const controller = new AbortController();
    const client = new HomeAssistantWebSocketClient(
      baseConfig,
      authenticatedFactory([], () => undefined),
    );
    const pending = client.runCommand(
      { type: "get_services" },
      controller.signal,
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
  });

  it("returns a stable authentication failure", async () => {
    const client = new HomeAssistantWebSocketClient(baseConfig, () => {
      const socket = new FakeSocket();
      socket.onSend = () => {
        queueMicrotask(() => socket.emit({ type: "auth_invalid" }));
      };
      queueMicrotask(() => socket.emit({ type: "auth_required" }));
      return socket;
    });

    await expect(
      client.runCommand({ type: "get_services" }),
    ).rejects.toMatchObject({ code: "AUTH_FAILED" });
  });
});
