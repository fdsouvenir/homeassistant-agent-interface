import { describe, expect, it, vi } from "vitest";
import { HomeAssistantClient } from "./client.js";
import { errorResult, InterfaceError } from "./errors.js";

const baseConfig = {
  baseUrl: "https://ha.example.test/",
  token: "test-token",
};

describe("HomeAssistantClient", () => {
  it("reports missing initial configuration at execution time", () => {
    expect(() => new HomeAssistantClient({}, vi.fn() as typeof fetch)).toThrow(
      expect.objectContaining({
        code: "CONFIG_REQUIRED",
        recovery: { action: "configure_plugin", fields: ["baseUrl"] },
      }),
    );
  });

  it("binds requests to the configured origin and disables redirects", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            entity_id: "sensor.example",
            state: "21",
            attributes: { unit_of_measurement: "°C" },
            last_changed: "2026-08-21T12:00:00.000Z",
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    const client = new HomeAssistantClient(
      baseConfig,
      fetchMock as typeof fetch,
    );

    await client.getState("sensor.example");

    const [url, options] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "https://ha.example.test/api/states/sensor.example",
    );
    expect(options).toMatchObject({
      method: "GET",
      redirect: "error",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: {
        accept: "application/json",
        authorization: "Bearer test-token",
      },
    });
  });

  it("fails closed before reading an oversized response", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("[]", { headers: { "content-length": "100000" } }),
    );
    const client = new HomeAssistantClient(
      { ...baseConfig, maxResponseBytes: 65_536 },
      fetchMock as typeof fetch,
    );

    await expect(client.getAllStates()).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE",
    });
  });

  it("returns stable auth errors without including response bodies", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("token=test-token and internal details", { status: 401 }),
    );
    const client = new HomeAssistantClient(
      baseConfig,
      fetchMock as typeof fetch,
    );

    let caught: unknown;
    try {
      await client.getAllStates();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InterfaceError);
    expect(JSON.stringify(errorResult(caught))).toBe(
      '{"ok":false,"error":{"code":"AUTH_FAILED","message":"Home Assistant rejected the access token.","retryable":false,"recovery":{"action":"configure_plugin","fields":["token"]}}}',
    );
  });

  it("rejects credentials embedded in baseUrl", () => {
    expect(
      () =>
        new HomeAssistantClient(
          {
            baseUrl: "https://user:password@ha.example.test",
            token: "test-token",
          },
          vi.fn() as unknown as typeof fetch,
        ),
    ).toThrow("cannot contain credentials");
  });

  it("preserves a configured reverse-proxy base path", async () => {
    const fetchMock = vi.fn(async () => new Response("[]"));
    const client = new HomeAssistantClient(
      { ...baseConfig, baseUrl: "https://ha.example.test/remote/ha" },
      fetchMock as typeof fetch,
    );

    await client.getAllStates();

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://ha.example.test/remote/ha/api/states",
    );
  });

  it("rejects a streamed response that crosses the byte cap", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('["'));
        controller.enqueue(new Uint8Array(70_000));
        controller.close();
      },
    });
    const fetchMock = vi.fn(async () => new Response(stream));
    const client = new HomeAssistantClient(
      { ...baseConfig, maxResponseBytes: 65_536 },
      fetchMock as typeof fetch,
    );

    await expect(client.getAllStates()).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE",
    });
  });

  it("rejects malformed state timestamps instead of reporting fresh state", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            entity_id: "light.example",
            state: "on",
            attributes: {},
            last_changed: "not-a-time",
          }),
        ),
    );
    const client = new HomeAssistantClient(
      baseConfig,
      fetchMock as typeof fetch,
    );

    await expect(client.getState("light.example")).rejects.toMatchObject({
      code: "UPSTREAM_INVALID_RESPONSE",
    });
  });

  it("rejects malformed history timestamps", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify([[{ state: "home", last_changed: "yesterdayish" }]]),
        ),
    );
    const client = new HomeAssistantClient(
      baseConfig,
      fetchMock as typeof fetch,
    );

    await expect(
      client.getHistory(
        ["person.example"],
        "2026-08-21T00:00:00.000Z",
        "2026-08-22T00:00:00.000Z",
      ),
    ).rejects.toMatchObject({ code: "UPSTREAM_INVALID_RESPONSE" });
  });

  it("returns a stable cancellation before starting fetch", async () => {
    const fetchMock = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const client = new HomeAssistantClient(
      baseConfig,
      fetchMock as unknown as typeof fetch,
    );

    await expect(client.getAllStates(controller.signal)).rejects.toMatchObject({
      code: "REQUEST_ABORTED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
