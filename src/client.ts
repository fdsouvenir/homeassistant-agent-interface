import { InterfaceError } from "./errors.js";
import type {
  HaConfig,
  HaHistoryState,
  HaState,
  PluginConfig,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

type FetchLike = typeof fetch;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  return value as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new InterfaceError(
      "UPSTREAM_INVALID_RESPONSE",
      `Home Assistant returned an invalid ${key} field.`,
    );
  }
  return value;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function requiredTimestamp(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = requiredString(record, key);
  if (!Number.isFinite(Date.parse(value))) {
    throw new InterfaceError(
      "UPSTREAM_INVALID_RESPONSE",
      `Home Assistant returned an invalid ${key} timestamp.`,
    );
  }
  return value;
}

function optionalTimestamp(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = optionalString(record, key);
  if (value !== undefined && !Number.isFinite(Date.parse(value))) {
    throw new InterfaceError(
      "UPSTREAM_INVALID_RESPONSE",
      `Home Assistant returned an invalid ${key} timestamp.`,
    );
  }
  return value;
}

function parseState(value: unknown): HaState {
  const record = asRecord(value);
  if (!record) {
    throw new InterfaceError(
      "UPSTREAM_INVALID_RESPONSE",
      "Home Assistant returned invalid state data.",
    );
  }
  const attributes = asRecord(record.attributes) ?? {};
  const lastUpdated = optionalTimestamp(record, "last_updated");
  return {
    entity_id: requiredString(record, "entity_id"),
    state: requiredString(record, "state"),
    attributes,
    last_changed: requiredTimestamp(record, "last_changed"),
    ...(lastUpdated === undefined ? {} : { last_updated: lastUpdated }),
  };
}

function parseHistoryState(value: unknown): HaHistoryState {
  const record = asRecord(value);
  if (!record) {
    throw new InterfaceError(
      "UPSTREAM_INVALID_RESPONSE",
      "Home Assistant returned invalid history data.",
    );
  }
  const entityId = optionalString(record, "entity_id");
  const lastUpdated = optionalTimestamp(record, "last_updated");
  const attributes = asRecord(record.attributes);
  return {
    state: requiredString(record, "state"),
    last_changed: requiredTimestamp(record, "last_changed"),
    ...(entityId === undefined ? {} : { entity_id: entityId }),
    ...(lastUpdated === undefined ? {} : { last_updated: lastUpdated }),
    ...(attributes === undefined ? {} : { attributes }),
  };
}

function parseConfig(value: unknown): HaConfig {
  const record = asRecord(value);
  if (!record) {
    throw new InterfaceError(
      "UPSTREAM_INVALID_RESPONSE",
      "Home Assistant returned invalid configuration data.",
    );
  }
  const components = Array.isArray(record.components)
    ? record.components.filter(
        (item): item is string => typeof item === "string",
      )
    : undefined;
  const version = optionalString(record, "version");
  const state = optionalString(record, "state");
  const timeZone = optionalString(record, "time_zone");
  return {
    ...(version === undefined ? {} : { version }),
    ...(state === undefined ? {} : { state }),
    ...(timeZone === undefined ? {} : { time_zone: timeZone }),
    ...(components === undefined ? {} : { components }),
  };
}

function normalizeBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
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
      {
        recovery: { action: "configure_plugin", fields: ["baseUrl"] },
      },
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
  return url;
}

async function readLimited(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new InterfaceError(
      "RESPONSE_TOO_LARGE",
      "Home Assistant response exceeded the configured byte limit.",
      { recovery: { action: "narrow_request" } },
    );
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new InterfaceError(
          "RESPONSE_TOO_LARGE",
          "Home Assistant response exceeded the configured byte limit.",
          { recovery: { action: "narrow_request" } },
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

function statusError(status: number): InterfaceError {
  if (status === 401) {
    return new InterfaceError(
      "AUTH_FAILED",
      "Home Assistant rejected the access token.",
      {
        recovery: { action: "configure_plugin", fields: ["token"] },
      },
    );
  }
  if (status === 403) {
    return new InterfaceError(
      "ACCESS_DENIED",
      "Home Assistant denied this read request.",
    );
  }
  if (status === 404) {
    return new InterfaceError(
      "NOT_FOUND",
      "The requested Home Assistant resource was not found.",
    );
  }
  return new InterfaceError(
    "UPSTREAM_UNAVAILABLE",
    `Home Assistant returned HTTP ${status}.`,
    {
      retryable: status === 429 || status >= 500,
      recovery: {
        action: status === 429 || status >= 500 ? "retry" : "narrow_request",
      },
    },
  );
}

export class HomeAssistantClient {
  readonly #baseUrl: URL;
  readonly #token: string;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #fetch: FetchLike;

  constructor(config: PluginConfig, fetchImplementation: FetchLike = fetch) {
    if (typeof config.baseUrl !== "string" || config.baseUrl.trim() === "") {
      throw new InterfaceError(
        "CONFIG_REQUIRED",
        "Configure the Home Assistant baseUrl.",
        {
          recovery: { action: "configure_plugin", fields: ["baseUrl"] },
        },
      );
    }
    if (typeof config.token !== "string" || config.token.trim() === "") {
      throw new InterfaceError(
        "CONFIG_REQUIRED",
        "Configure a Home Assistant access token.",
        {
          recovery: { action: "configure_plugin", fields: ["token"] },
        },
      );
    }
    this.#baseUrl = normalizeBaseUrl(config.baseUrl.trim());
    this.#token = config.token.trim();
    this.#timeoutMs = config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#maxResponseBytes =
      config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.#fetch = fetchImplementation;
  }

  async #getJson(path: string, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) {
      throw new InterfaceError(
        "REQUEST_ABORTED",
        "Home Assistant request was cancelled.",
      );
    }
    const url = new URL(path, this.#baseUrl);
    if (
      url.origin !== this.#baseUrl.origin ||
      !url.pathname.startsWith(this.#baseUrl.pathname)
    ) {
      throw new InterfaceError(
        "INVALID_INPUT",
        "Request path escaped the configured Home Assistant URL.",
      );
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });

    try {
      const response = await this.#fetch(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.#token}`,
        },
        redirect: "error",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (!response.ok) throw statusError(response.status);
      const text = await readLimited(response, this.#maxResponseBytes);
      try {
        return JSON.parse(text) as unknown;
      } catch (error) {
        throw new InterfaceError(
          "UPSTREAM_INVALID_RESPONSE",
          "Home Assistant returned invalid JSON.",
          { cause: error },
        );
      }
    } catch (error) {
      if (error instanceof InterfaceError) throw error;
      if (timedOut) {
        throw new InterfaceError(
          "UPSTREAM_TIMEOUT",
          "Home Assistant request timed out.",
          {
            retryable: true,
            recovery: { action: "retry" },
            cause: error,
          },
        );
      }
      if (signal?.aborted) {
        throw new InterfaceError(
          "REQUEST_ABORTED",
          "Home Assistant request was cancelled.",
          {
            cause: error,
          },
        );
      }
      throw new InterfaceError(
        "UPSTREAM_UNAVAILABLE",
        "Home Assistant could not be reached.",
        {
          retryable: true,
          recovery: { action: "retry" },
          cause: error,
        },
      );
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }

  async getAllStates(signal?: AbortSignal): Promise<HaState[]> {
    const value = await this.#getJson("api/states", signal);
    if (!Array.isArray(value)) {
      throw new InterfaceError(
        "UPSTREAM_INVALID_RESPONSE",
        "Home Assistant returned an invalid states collection.",
      );
    }
    return value.map(parseState);
  }

  async getState(entityId: string, signal?: AbortSignal): Promise<HaState> {
    return parseState(
      await this.#getJson(`api/states/${encodeURIComponent(entityId)}`, signal),
    );
  }

  async getConfig(signal?: AbortSignal): Promise<HaConfig> {
    return parseConfig(await this.#getJson("api/config", signal));
  }

  async getHistory(
    entityIds: string[],
    start: string,
    end: string,
    signal?: AbortSignal,
  ): Promise<HaHistoryState[][]> {
    const query = new URLSearchParams({
      end_time: end,
      filter_entity_id: entityIds.join(","),
      minimal_response: "1",
      significant_changes_only: "1",
    });
    const value = await this.#getJson(
      `api/history/period/${encodeURIComponent(start)}?${query.toString()}`,
      signal,
    );
    if (!Array.isArray(value)) {
      throw new InterfaceError(
        "UPSTREAM_INVALID_RESPONSE",
        "Home Assistant returned an invalid history collection.",
      );
    }
    return value.map((group) => {
      if (!Array.isArray(group)) {
        throw new InterfaceError(
          "UPSTREAM_INVALID_RESPONSE",
          "Home Assistant returned an invalid history group.",
        );
      }
      return group.map(parseHistoryState);
    });
  }
}
