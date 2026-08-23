import type {
  EntityProjection,
  Fact,
  HaState,
  JsonPrimitive,
} from "./types.js";
import { compactJson } from "./compact.js";
import { entityDomain } from "./scope.js";

export type DetailLevel = "summary" | "detail" | "full";

function friendlyName(state: HaState): string {
  const value = state.attributes.friendly_name;
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : state.entity_id;
}

function numberAttribute(state: HaState, key: string): number | undefined {
  const value = state.attributes[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function primitiveAttribute(
  state: HaState,
  key: string,
): JsonPrimitive | undefined {
  const value = state.attributes[key];
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : undefined;
}

function addFact(
  facts: Fact[],
  key: string,
  value: JsonPrimitive | undefined,
  unit?: string,
): void {
  if (value === undefined) return;
  facts.push({ key, value, ...(unit === undefined ? {} : { unit }) });
}

function unit(state: HaState): string | undefined {
  const value = state.attributes.unit_of_measurement;
  return typeof value === "string" ? value : undefined;
}

function commonFacts(state: HaState, facts: Fact[]): void {
  addFact(facts, "device_class", primitiveAttribute(state, "device_class"));
  const battery = numberAttribute(state, "battery_level");
  addFact(facts, "battery", battery, battery === undefined ? undefined : "%");
}

function domainFacts(state: HaState, facts: Fact[]): void {
  const domain = entityDomain(state.entity_id);
  switch (domain) {
    case "sensor": {
      const numeric = Number(state.state);
      if (Number.isFinite(numeric))
        addFact(facts, "value", numeric, unit(state));
      break;
    }
    case "binary_sensor":
      addFact(facts, "is_on", state.state === "on");
      break;
    case "person":
    case "device_tracker":
      addFact(facts, "zone", state.state);
      addFact(facts, "source", primitiveAttribute(state, "source"));
      break;
    case "climate":
      addFact(
        facts,
        "target_temperature",
        numberAttribute(state, "temperature"),
        unit(state),
      );
      addFact(
        facts,
        "current_temperature",
        numberAttribute(state, "current_temperature"),
        unit(state),
      );
      addFact(
        facts,
        "target_humidity",
        numberAttribute(state, "humidity"),
        "%",
      );
      addFact(
        facts,
        "current_humidity",
        numberAttribute(state, "current_humidity"),
        "%",
      );
      addFact(facts, "hvac_action", primitiveAttribute(state, "hvac_action"));
      break;
    case "light": {
      addFact(facts, "is_on", state.state === "on");
      const brightness = numberAttribute(state, "brightness");
      if (brightness !== undefined)
        addFact(facts, "brightness", Math.round((brightness / 255) * 100), "%");
      addFact(facts, "color_mode", primitiveAttribute(state, "color_mode"));
      break;
    }
    case "cover":
      addFact(
        facts,
        "position",
        numberAttribute(state, "current_position"),
        "%",
      );
      addFact(
        facts,
        "tilt_position",
        numberAttribute(state, "current_tilt_position"),
        "%",
      );
      break;
    case "media_player":
      addFact(facts, "volume", numberAttribute(state, "volume_level"));
      addFact(facts, "muted", primitiveAttribute(state, "is_volume_muted"));
      addFact(facts, "source", primitiveAttribute(state, "source"));
      break;
    case "weather":
      addFact(
        facts,
        "temperature",
        numberAttribute(state, "temperature"),
        unit(state),
      );
      addFact(facts, "humidity", numberAttribute(state, "humidity"), "%");
      addFact(facts, "pressure", numberAttribute(state, "pressure"));
      addFact(facts, "wind_speed", numberAttribute(state, "wind_speed"));
      break;
    default:
      break;
  }
}

function fullFacts(state: HaState, facts: Fact[]): void {
  addFact(facts, "assumed_state", primitiveAttribute(state, "assumed_state"));
  addFact(facts, "restored", primitiveAttribute(state, "restored"));
  addFact(
    facts,
    "entity_category",
    primitiveAttribute(state, "entity_category"),
  );
}

export function projectState(
  state: HaState,
  detail: DetailLevel,
  now: Date = new Date(),
  attributeKeys: string[] = [],
): EntityProjection {
  const changed = Date.parse(state.last_changed);
  if (!Number.isFinite(changed)) {
    throw new Error(`Invalid last_changed timestamp for ${state.entity_id}`);
  }
  const changedSecondsAgo = Math.max(
    0,
    Math.floor((now.getTime() - changed) / 1000),
  );
  const projection: EntityProjection = {
    entity_id: state.entity_id,
    name: friendlyName(state),
    domain: entityDomain(state.entity_id),
    state: state.state,
    available: state.state !== "unavailable" && state.state !== "unknown",
    changed_at: state.last_changed,
    changed_seconds_ago: changedSecondsAgo,
    ...(state.last_updated === undefined
      ? {}
      : { updated_at: state.last_updated }),
  };
  if (detail === "summary") return projection;

  const facts: Fact[] = [];
  commonFacts(state, facts);
  domainFacts(state, facts);
  if (detail === "full") fullFacts(state, facts);
  if (facts.length > 0) projection.facts = facts;
  if (attributeKeys.length > 0) {
    const attributes: Record<string, unknown> = {};
    let attributesTruncated = false;
    for (const key of attributeKeys) {
      if (Object.hasOwn(state.attributes, key)) {
        const compacted = compactJson(state.attributes[key], {
          maxDepth: 4,
          maxArrayItems: 25,
          maxObjectKeys: 50,
          maxStringLength: 1_000,
        });
        attributes[key] = compacted.value;
        attributesTruncated ||= compacted.truncated;
      }
    }
    projection.attributes = attributes;
    if (attributesTruncated) projection.attributes_truncated = true;
  }
  return projection;
}

export type AttentionItem = {
  entity_id: string;
  name: string;
  severity: "critical" | "warning";
  reason:
    | "alarm_triggered"
    | "low_battery"
    | "safety_active"
    | "unavailable"
    | "unknown";
  state: string;
};

export function attentionForState(state: HaState): AttentionItem | undefined {
  const base = {
    entity_id: state.entity_id,
    name: friendlyName(state),
    state: state.state,
  };
  if (state.state === "unavailable")
    return { ...base, severity: "warning", reason: "unavailable" };
  if (state.state === "unknown")
    return { ...base, severity: "warning", reason: "unknown" };
  if (
    entityDomain(state.entity_id) === "alarm_control_panel" &&
    state.state === "triggered"
  ) {
    return { ...base, severity: "critical", reason: "alarm_triggered" };
  }
  const deviceClass = state.attributes.device_class;
  if (
    entityDomain(state.entity_id) === "binary_sensor" &&
    state.state === "on" &&
    typeof deviceClass === "string" &&
    ["gas", "moisture", "problem", "safety", "smoke"].includes(deviceClass)
  ) {
    return { ...base, severity: "critical", reason: "safety_active" };
  }
  const battery =
    numberAttribute(state, "battery_level") ??
    (state.attributes.device_class === "battery"
      ? Number(state.state)
      : undefined);
  if (battery !== undefined && Number.isFinite(battery) && battery <= 20) {
    return { ...base, severity: "warning", reason: "low_battery" };
  }
  return undefined;
}
