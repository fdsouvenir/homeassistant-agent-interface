import { describe, expect, it, vi } from "vitest";
import { HomeAssistantClient } from "./client.js";
import { errorResult, InterfaceError } from "./errors.js";

const baseConfig = {
  baseUrl: "https://ha.example.test/",
  token: "test-token",
};

describe("HomeAssistantClient", () => {
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
});
