import { Value } from "typebox/value";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runBrief,
  runDiagnose,
  runFind,
  runInspect,
  runPresence,
} from "./operations.js";
import {
  briefOutputSchema,
  diagnoseOutputSchema,
  findOutputSchema,
  inspectOutputSchema,
  presenceOutputSchema,
} from "./schemas.js";

const config = {
  baseUrl: "https://ha.example.test/",
  token: "test-token",
};

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
        allowedDomains: ["sensor", "person"],
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

    const result = await runFind({ query: "missing" }, config);

    expect(result).toEqual({
      ok: true,
      query: "missing",
      total: 0,
      returned: 0,
      truncated: false,
      matches: [],
    });
    expect(Value.Check(findOutputSchema, result)).toBe(true);
  });

  it("uses safe semantic projections even at full detail", async () => {
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
      { ...config, allowedDomains: ["person", "device_tracker"] },
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
});
