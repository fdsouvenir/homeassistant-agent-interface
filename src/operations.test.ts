import { Value } from "typebox/value";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runBrief,
  runDiagnose,
  runExecute,
  runFind,
  runInspect,
  runPresence,
} from "./operations.js";
import {
  briefOutputSchema,
  diagnoseOutputSchema,
  executeOutputSchema,
  findOutputSchema,
  inspectOutputSchema,
  presenceOutputSchema,
} from "./schemas.js";

const config = {
  baseUrl: "https://ha.example.test/",
  token: "test-token",
};

class FakeHaSocket extends EventTarget {
  binaryType: BinaryType = "blob";

  constructor(
    readonly responder: (
      message: Record<string, unknown>,
    ) => Record<string, unknown>,
  ) {
    super();
    queueMicrotask(() => this.emit({ type: "auth_required" }));
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    const message = JSON.parse(String(data)) as Record<string, unknown>;
    if (message.type === "auth") {
      queueMicrotask(() => this.emit({ type: "auth_ok" }));
      return;
    }
    const response = this.responder(message);
    queueMicrotask(() =>
      this.emit({ id: message.id, type: "result", ...response }),
    );
  }

  close(_code?: number, _reason?: string) {}

  emit(value: unknown) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(value) }),
    );
  }
}

function stubWebSocket(
  responder: (message: Record<string, unknown>) => Record<string, unknown>,
) {
  vi.stubGlobal(
    "WebSocket",
    class extends FakeHaSocket {
      constructor(_url: string) {
        super(responder);
      }
    },
  );
}

function state(
  entityId: string,
  value: string,
  attributes: Record<string, unknown> = {},
  changed = "2026-08-21T12:00:00.000Z",
) {
  return {
    entity_id: entityId,
    state: value,
    attributes,
    last_changed: changed,
    last_updated: changed,
  };
}

function json(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AXI-shaped operations", () => {
  it("returns a bounded briefing from neutral configured targets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("sensor.example_temperature")) {
          return json(
            state("sensor.example_temperature", "19.5", {
              friendly_name: "Example temperature",
              device_class: "temperature",
              unit_of_measurement: "°C",
            }),
          );
        }
        return json(
          state("person.example", "home", {
            friendly_name: "Example person",
            latitude: 41.1,
            longitude: -87.2,
            source: "device_tracker.example_phone",
          }),
        );
      }),
    );

    const result = await runBrief(
      {},
      {
        ...config,
        briefEntities: ["sensor.example_temperature", "person.example"],
      },
    );

    expect(result).toMatchObject({
      ok: true,
      scope: { requested: 2, resolved: 2 },
      counts: { available: 2, presence: 1 },
    });
    expect(JSON.stringify(result)).not.toContain("latitude");
    expect(JSON.stringify(result)).not.toContain("longitude");
    expect(Value.Check(briefOutputSchema, result)).toBe(true);
  });

  it("returns a definitive empty find result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json([
          state("light.example", "off", { friendly_name: "Example light" }),
        ]),
      ),
    );

    const result = await runFind(
      { query: "missing", kinds: ["entity"] },
      config,
    );

    expect(result).toEqual({
      ok: true,
      query: "missing",
      coverage: {
        partial: false,
        available_kinds: ["entity"],
        unavailable_kinds: [],
      },
      total: 0,
      returned: 0,
      truncated: false,
      matches: [],
    });
    expect(Value.Check(findOutputSchema, result)).toBe(true);
  });

  it("uses compact semantic projections even at full detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(
          state("device_tracker.example_phone", "work", {
            friendly_name: "Example phone",
            latitude: 41.1,
            longitude: -87.2,
            gps_accuracy: 8,
            battery_level: 64,
          }),
        ),
      ),
    );

    const result = await runInspect(
      { targets: ["device_tracker.example_phone"], detail: "full" },
      config,
    );

    const serialized = JSON.stringify(result);
    expect(serialized).toContain('"battery"');
    expect(serialized).not.toContain("latitude");
    expect(serialized).not.toContain("longitude");
    expect(serialized).not.toContain("gps_accuracy");
    expect(Value.Check(inspectOutputSchema, result)).toBe(true);
  });

  it("summarizes presence transitions and time by zone in one call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname.includes("/api/history/period/")) {
          return json([
            [
              state("person.example", "home", {}, "2026-08-21T08:00:00.000Z"),
              { state: "work", last_changed: "2026-08-21T10:00:00.000Z" },
              { state: "home", last_changed: "2026-08-21T16:00:00.000Z" },
            ],
          ]);
        }
        return json(
          state(
            "person.example",
            "home",
            {
              friendly_name: "Example person",
              source: "device_tracker.example_phone",
              latitude: 41.1,
              longitude: -87.2,
            },
            "2026-08-21T16:00:00.000Z",
          ),
        );
      }),
    );

    const result = await runPresence(
      {
        targets: ["person.example"],
        start: "2026-08-21T08:00:00.000Z",
        end: "2026-08-21T20:00:00.000Z",
      },
      config,
    );

    expect(result).toMatchObject({
      ok: true,
      total: 1,
      returned: 1,
      people: [
        {
          entity_id: "person.example",
          current: { zone: "home", source: "device_tracker.example_phone" },
          window: {
            observed: true,
            transitions: { total: 2, returned: 2, truncated: false },
          },
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("latitude");
    expect(Value.Check(presenceOutputSchema, result)).toBe(true);
  });

  it("diagnoses health without projecting sensitive instance configuration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/api/config")) {
          return json({
            version: "2026.8.0",
            state: "RUNNING",
            time_zone: "Etc/UTC",
            components: ["api", "history", "recorder"],
            latitude: 41.1,
            longitude: -87.2,
            config_dir: "/private/homeassistant",
          });
        }
        return json([
          state("sensor.example", "21", { friendly_name: "Example sensor" }),
          state("binary_sensor.example", "unavailable", {
            friendly_name: "Example binary sensor",
          }),
        ]);
      }),
    );

    const result = await runDiagnose({}, config);

    expect(result).toMatchObject({
      ok: true,
      instance: {
        version: "2026.8.0",
        recorder_available: true,
        history_available: true,
      },
      entities: { total: 2, available: 1, unavailable: 1, unknown: 0 },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("latitude");
    expect(serialized).not.toContain("longitude");
    expect(serialized).not.toContain("config_dir");
    expect(Value.Check(diagnoseOutputSchema, result)).toBe(true);
  });

  it("discovers live actions and organizational targets in one bounded search", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json([])),
    );
    stubWebSocket((message) => {
      if (message.type === "get_services") {
        return {
          success: true,
          result: {
            light: {
              turn_on: {
                name: "Turn on",
                description: "Turn a light on.",
                target: { entity: [{ domain: "light" }] },
                fields: { brightness_pct: {}, transition: {} },
              },
            },
          },
        };
      }
      return {
        success: true,
        result: [
          {
            area_id: "kitchen",
            name: "Kitchen",
            floor_id: "ground_floor",
            aliases: ["Cooking area"],
          },
        ],
      };
    });

    const result = await runFind(
      { kinds: ["action", "area"], limit: 10 },
      config,
    );

    expect(result).toMatchObject({
      ok: true,
      total: 2,
      coverage: {
        partial: false,
        available_kinds: ["action", "area"],
      },
      matches: [
        {
          kind: "action",
          id: "light.turn_on",
          fields: ["brightness_pct", "transition"],
        },
        { kind: "area", id: "kitchen", floor_id: "ground_floor" },
      ],
    });
    expect(Value.Check(findOutputSchema, result)).toBe(true);
  });

  it("marks discovery coverage partial instead of claiming an empty registry", async () => {
    stubWebSocket((message) =>
      message.type === "get_services"
        ? { success: true, result: {} }
        : {
            success: false,
            error: { code: "unauthorized", message: "Not permitted" },
          },
    );

    const result = await runFind(
      { query: "missing", kinds: ["action", "area"] },
      config,
    );

    expect(result).toMatchObject({
      ok: true,
      total: 0,
      coverage: {
        partial: true,
        available_kinds: ["action"],
        unavailable_kinds: ["area"],
      },
    });
    expect(Value.Check(findOutputSchema, result)).toBe(true);
  });

  it("adds field guidance for an exact action match", async () => {
    stubWebSocket(() => ({
      success: true,
      result: {
        light: {
          turn_on: {
            name: "Turn on",
            fields: {
              brightness_pct: {
                description: "Brightness percentage.",
                required: false,
                example: 60,
                selector: { number: { min: 0, max: 100 } },
              },
              effect: {
                required: false,
                selector: { select: { options: ["rainbow", "pulse"] } },
              },
            },
          },
        },
      },
    }));

    const result = await runFind(
      { query: "light.turn_on", kinds: ["action"] },
      config,
    );

    expect(result).toMatchObject({
      ok: true,
      total: 1,
      matches: [
        {
          id: "light.turn_on",
          field_details: [
            {
              name: "brightness_pct",
              selector: "number",
              example: 60,
            },
            {
              name: "effect",
              selector: "select",
              options: ["rainbow", "pulse"],
            },
          ],
        },
      ],
    });
    expect(Value.Check(findOutputSchema, result)).toBe(true);
  });

  it("does not report malformed catalog data as an empty result", async () => {
    stubWebSocket(() => ({ success: true, result: [] }));

    const result = await runFind({ query: "light", kinds: ["action"] }, config);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "UPSTREAM_INVALID_RESPONSE" },
    });
    expect(Value.Check(findOutputSchema, result)).toBe(true);
  });

  it("executes a general action and reports compact before/after state", async () => {
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        reads += 1;
        return json([
          state(
            "light.example",
            reads === 1 ? "off" : "on",
            reads === 1
              ? { friendly_name: "Example light" }
              : { friendly_name: "Example light", brightness: 128 },
            reads === 1
              ? "2026-08-21T12:00:00.000Z"
              : "2026-08-21T12:00:01.000Z",
          ),
        ]);
      }),
    );
    stubWebSocket(() => ({
      success: true,
      result: { context: { id: "context-123" } },
    }));

    const result = await runExecute(
      {
        action: "light.turn_on",
        target: { entity_id: ["light.example"] },
        data: { brightness_pct: 50 },
      },
      config,
    );

    expect(result).toMatchObject({
      ok: true,
      action: "light.turn_on",
      context_id: "context-123",
      observation: {
        status: "observed",
        outcome: "changed",
        attempts: 1,
        total: 1,
        changed: 1,
        items: [
          {
            entity_id: "light.example",
            changed: true,
            before: { state: "off" },
            after: { state: "on" },
          },
        ],
      },
    });
    expect(Value.Check(executeOutputSchema, result)).toBe(true);
  });

  it("polls until an asynchronous device state change is visible", async () => {
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        reads += 1;
        return json([
          state(
            "light.delayed",
            reads < 3 ? "off" : "on",
            { friendly_name: "Delayed light" },
            reads < 3 ? "2026-08-21T12:00:00.000Z" : "2026-08-21T12:00:01.000Z",
          ),
        ]);
      }),
    );
    stubWebSocket(() => ({
      success: true,
      result: { context: { id: "context-delayed" } },
    }));

    const result = await runExecute(
      {
        action: "light.turn_on",
        target: { entity_id: ["light.delayed"] },
        settle_ms: 300,
        poll_interval_ms: 100,
      },
      config,
    );

    expect(result).toMatchObject({
      ok: true,
      observation: {
        status: "observed",
        outcome: "changed",
        settle_ms: 300,
        attempts: 2,
        changed: 1,
        items: [{ entity_id: "light.delayed", after: { state: "on" } }],
      },
    });
    expect(
      result.ok === true ? result.observation.waited_ms : 0,
    ).toBeGreaterThanOrEqual(90);
    expect(Value.Check(executeOutputSchema, result)).toBe(true);
  });

  it("distinguishes a completed settle window with no observed change", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json([
          state("light.already_on", "on", {
            friendly_name: "Already-on light",
          }),
        ]),
      ),
    );
    stubWebSocket(() => ({
      success: true,
      result: { context: { id: "context-no-change" } },
    }));

    const result = await runExecute(
      {
        action: "light.turn_on",
        target: { entity_id: ["light.already_on"] },
        settle_ms: 220,
        poll_interval_ms: 100,
      },
      config,
    );

    expect(result).toMatchObject({
      ok: true,
      observation: {
        status: "observed",
        outcome: "no_change_observed",
        settle_ms: 220,
        changed: 0,
      },
    });
    if (result.ok === true) {
      expect(result.observation.attempts).toBeGreaterThanOrEqual(3);
      expect(result.observation.waited_ms).toBeGreaterThanOrEqual(200);
    }
    expect(Value.Check(executeOutputSchema, result)).toBe(true);
  });

  it("cancels an in-progress observation settle window", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json([state("light.delayed", "off")])),
    );
    stubWebSocket(() => ({
      success: true,
      result: { context: { id: "context-abort" } },
    }));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);

    const result = await runExecute(
      {
        action: "light.turn_on",
        target: { entity_id: ["light.delayed"] },
        settle_ms: 1_000,
        poll_interval_ms: 100,
      },
      config,
      { signal: controller.signal },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "REQUEST_ABORTED" },
    });
    expect(Value.Check(executeOutputSchema, result)).toBe(true);
  });

  it("returns action response data without forcing an entity target", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    stubWebSocket(() => ({
      success: true,
      result: {
        context: { id: "context-456" },
        response: { speech: "hello" },
      },
    }));

    const result = await runExecute(
      {
        action: "conversation.process",
        data: { text: "hello" },
        return_response: true,
      },
      config,
    );

    expect(result).toMatchObject({
      ok: true,
      response: { speech: "hello" },
      observation: { status: "not_applicable", total: 0 },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(Value.Check(executeOutputSchema, result)).toBe(true);
  });

  it("explicitly truncates oversized action response values", async () => {
    vi.stubGlobal("fetch", vi.fn());
    stubWebSocket(() => ({
      success: true,
      result: {
        context: { id: "context-large" },
        response: { text: "x".repeat(3_000) },
      },
    }));

    const result = await runExecute(
      {
        action: "conversation.process",
        return_response: true,
      },
      config,
    );

    expect(result).toMatchObject({
      ok: true,
      response_truncated: true,
    });
    expect(JSON.stringify(result).length).toBeLessThan(2_500);
    expect(Value.Check(executeOutputSchema, result)).toBe(true);
  });

  it("resolves area targets for observation without changing action semantics", async () => {
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        reads += 1;
        return json([
          state(
            "light.kitchen",
            reads === 1 ? "off" : "on",
            { friendly_name: "Kitchen light" },
            reads === 1
              ? "2026-08-21T12:00:00.000Z"
              : "2026-08-21T12:00:02.000Z",
          ),
        ]);
      }),
    );
    stubWebSocket((message) =>
      message.type === "extract_from_target"
        ? {
            success: true,
            result: {
              referenced_entities: ["light.kitchen"],
              missing_devices: [],
              missing_areas: ["old_kitchen"],
              missing_floors: [],
              missing_labels: [],
            },
          }
        : { success: true, result: { context: { id: "context-789" } } },
    );

    const result = await runExecute(
      {
        action: "light.turn_on",
        target: { area_id: ["kitchen", "old_kitchen"] },
      },
      config,
    );

    expect(result).toMatchObject({
      ok: true,
      observation: { status: "observed", total: 1, changed: 1 },
      missing_targets: [{ kind: "area", id: "old_kitchen" }],
    });
    expect(Value.Check(executeOutputSchema, result)).toBe(true);
  });

  it("returns ambiguous entity names without guessing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json([
          state("light.kitchen_main", "off", { friendly_name: "Kitchen" }),
          state("switch.kitchen_main", "off", { friendly_name: "Kitchen" }),
        ]),
      ),
    );

    const result = await runInspect({ targets: ["Kitchen"] }, config);

    expect(result).toMatchObject({
      ok: true,
      returned: 0,
      unresolved: [
        {
          target: "Kitchen",
          reason: "ambiguous",
          candidate_entity_ids: ["light.kitchen_main", "switch.kitchen_main"],
        },
      ],
    });
  });

  it("keeps successful exact inspections when another target is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).endsWith("light.failed")
          ? new Response("failure", { status: 503 })
          : json(state("light.example", "on", { friendly_name: "Example" })),
      ),
    );

    const result = await runInspect(
      { targets: ["light.example", "light.failed"] },
      config,
    );

    expect(result).toMatchObject({
      ok: true,
      returned: 1,
      unresolved: [{ target: "light.failed", reason: "unavailable" }],
    });
    expect(Value.Check(inspectOutputSchema, result)).toBe(true);
  });

  it("returns exact dynamic attributes only when requested", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(
          state("device_tracker.example_phone", "home", {
            friendly_name: "Example phone",
            latitude: 41.1,
            longitude: -87.2,
            battery_level: 65,
          }),
        ),
      ),
    );

    const result = await runInspect(
      {
        targets: ["device_tracker.example_phone"],
        attribute_keys: ["latitude", "longitude", "missing"],
      },
      config,
    );

    expect(result).toMatchObject({
      ok: true,
      entities: [{ attributes: { latitude: 41.1, longitude: -87.2 } }],
    });
    expect(JSON.stringify(result)).not.toContain('"missing"');
    expect(Value.Check(inspectOutputSchema, result)).toBe(true);
  });
});
