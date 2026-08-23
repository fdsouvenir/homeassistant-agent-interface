import { HomeAssistantClient } from "./client.js";
import { InterfaceError } from "./errors.js";
import { entityDomain } from "./scope.js";
import type {
  DiscoveryKind,
  HaState,
  PluginConfig,
  WebSocketCommand,
} from "./types.js";
import {
  HomeAssistantWebSocketClient,
  type CommandOutcome,
} from "./websocket.js";

export type DiscoveryMatch = {
  kind: DiscoveryKind;
  id: string;
  name: string;
  matched_on: "all" | "id" | "name" | "alias" | "description";
  domain?: string;
  state?: string;
  area_id?: string;
  floor_id?: string;
  device_id?: string;
  description?: string;
  aliases?: string[];
  fields?: string[];
  field_details?: Array<{
    name: string;
    required: boolean;
    description?: string;
    selector?: string;
    example?: unknown;
    default?: unknown;
    options?: Array<string | number | boolean | null>;
  }>;
  fields_truncated?: boolean;
  target_supported?: boolean;
  response?: "none" | "optional" | "required";
  manufacturer?: string;
  model?: string;
  level?: number;
};

type Candidate = Omit<DiscoveryMatch, "matched_on"> & {
  searchAliases?: string[];
};

type ScoredMatch = DiscoveryMatch & { score: number };

export type DiscoveryResult = {
  matches: ScoredMatch[];
  availableKinds: DiscoveryKind[];
  unavailableKinds: DiscoveryKind[];
};

const ALL_KINDS: DiscoveryKind[] = [
  "entity",
  "action",
  "area",
  "device",
  "floor",
  "label",
];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function stringValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.trim() !== "",
  );
}

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    return record ? [record] : [];
  });
}

function friendlyName(state: HaState): string {
  return stringValue(state.attributes, "friendly_name") ?? state.entity_id;
}

function normalized(value: string): string {
  return value
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function match(candidate: Candidate, query: string): ScoredMatch | undefined {
  const {
    searchAliases = [],
    field_details: fieldDetails,
    ...result
  } = candidate;
  if (query === "") return { ...result, matched_on: "all", score: 1 };
  const normalizedQuery = normalized(query);
  const id = normalized(candidate.id);
  const name = normalized(candidate.name);
  const aliases = searchAliases.map(normalized);
  const description = normalized(candidate.description ?? "");
  let score = 0;
  let matchedOn: DiscoveryMatch["matched_on"] = "id";
  if (normalizedQuery === id) score = 100;
  else if (normalizedQuery === name) {
    score = 98;
    matchedOn = "name";
  } else if (aliases.includes(normalizedQuery)) {
    score = 96;
    matchedOn = "alias";
  } else if (id.startsWith(normalizedQuery)) score = 82;
  else if (name.startsWith(normalizedQuery)) {
    score = 80;
    matchedOn = "name";
  } else if (aliases.some((alias) => alias.startsWith(normalizedQuery))) {
    score = 78;
    matchedOn = "alias";
  } else if (id.includes(normalizedQuery)) score = 66;
  else if (name.includes(normalizedQuery)) {
    score = 64;
    matchedOn = "name";
  } else if (aliases.some((alias) => alias.includes(normalizedQuery))) {
    score = 62;
    matchedOn = "alias";
  } else if (description.includes(normalizedQuery)) {
    score = 40;
    matchedOn = "description";
  }
  return score === 0
    ? undefined
    : {
        ...result,
        ...(score >= 95 && fieldDetails ? { field_details: fieldDetails } : {}),
        matched_on: matchedOn,
        score,
      };
}

function primitive(
  value: unknown,
): string | number | boolean | null | undefined {
  return value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : undefined;
}

function fieldDetails(fields: Record<string, unknown>) {
  return Object.entries(fields)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 24)
    .map(([name, value]) => {
      const field = asRecord(value) ?? {};
      const selector = asRecord(field.selector);
      const selectorName = selector
        ? Object.keys(selector).sort()[0]
        : undefined;
      const selectorConfig = selectorName
        ? asRecord(selector?.[selectorName])
        : undefined;
      const optionValues = Array.isArray(selectorConfig?.options)
        ? selectorConfig.options.flatMap((option) => {
            const direct = primitive(option);
            if (direct !== undefined) return [direct];
            const optionRecord = asRecord(option);
            const nested = primitive(optionRecord?.value);
            return nested === undefined ? [] : [nested];
          })
        : [];
      const description = stringValue(field, "description");
      const example = primitive(field.example);
      const defaultValue = primitive(field.default);
      return {
        name,
        required: field.required === true,
        ...(description ? { description: description.slice(0, 300) } : {}),
        ...(selectorName ? { selector: selectorName } : {}),
        ...(example === undefined ? {} : { example }),
        ...(defaultValue === undefined ? {} : { default: defaultValue }),
        ...(optionValues.length > 0
          ? { options: optionValues.slice(0, 20) }
          : {}),
      };
    });
}

function entityCandidates(
  states: HaState[],
  entityRegistry: unknown,
): Candidate[] {
  const entries = new Map<string, Record<string, unknown>>();
  for (const entry of records(entityRegistry)) {
    const entityId = stringValue(entry, "entity_id");
    if (entityId) entries.set(entityId, entry);
  }
  return states.map((state) => {
    const entry = entries.get(state.entity_id);
    const aliases = stringList(entry?.aliases);
    const areaId = entry ? stringValue(entry, "area_id") : undefined;
    const deviceId = entry ? stringValue(entry, "device_id") : undefined;
    return {
      kind: "entity",
      id: state.entity_id,
      name: friendlyName(state),
      domain: entityDomain(state.entity_id),
      state: state.state,
      ...(areaId ? { area_id: areaId } : {}),
      ...(deviceId ? { device_id: deviceId } : {}),
      ...(aliases.length > 0 ? { aliases } : {}),
      searchAliases: aliases,
    };
  });
}

function actionCandidates(value: unknown): Candidate[] {
  const domains = asRecord(value);
  if (!domains) return [];
  const candidates: Candidate[] = [];
  for (const [domain, servicesValue] of Object.entries(domains)) {
    const services = asRecord(servicesValue);
    if (!services) continue;
    for (const [service, descriptionValue] of Object.entries(services)) {
      const description = asRecord(descriptionValue) ?? {};
      const id = `${domain}.${service}`;
      const name = stringValue(description, "name") ?? id;
      const summary = stringValue(description, "description");
      const fieldsRecord = asRecord(description.fields) ?? {};
      const allFields = Object.keys(fieldsRecord).sort();
      const fields = allFields.slice(0, 24);
      const responseRecord = asRecord(description.response);
      const response = responseRecord
        ? responseRecord.optional === true
          ? ("optional" as const)
          : ("required" as const)
        : ("none" as const);
      candidates.push({
        kind: "action",
        id,
        name,
        domain,
        ...(summary ? { description: summary.slice(0, 500) } : {}),
        ...(fields.length > 0 ? { fields } : {}),
        ...(fields.length > 0
          ? { field_details: fieldDetails(fieldsRecord) }
          : {}),
        ...(allFields.length > fields.length ? { fields_truncated: true } : {}),
        target_supported: asRecord(description.target) !== undefined,
        response,
      });
    }
  }
  return candidates;
}

function areaCandidates(value: unknown): Candidate[] {
  return records(value).flatMap((entry) => {
    const id = stringValue(entry, "area_id") ?? stringValue(entry, "id");
    const name = stringValue(entry, "name");
    if (!id || !name) return [];
    const aliases = stringList(entry.aliases);
    const floorId = stringValue(entry, "floor_id");
    return [
      {
        kind: "area" as const,
        id,
        name,
        ...(floorId ? { floor_id: floorId } : {}),
        ...(aliases.length > 0 ? { aliases } : {}),
        searchAliases: aliases,
      },
    ];
  });
}

function deviceCandidates(value: unknown): Candidate[] {
  return records(value).flatMap((entry) => {
    const id = stringValue(entry, "id");
    const name =
      stringValue(entry, "name_by_user") ?? stringValue(entry, "name") ?? id;
    if (!id || !name) return [];
    const areaId = stringValue(entry, "area_id");
    const manufacturer = stringValue(entry, "manufacturer");
    const model = stringValue(entry, "model");
    return [
      {
        kind: "device" as const,
        id,
        name,
        ...(areaId ? { area_id: areaId } : {}),
        ...(manufacturer ? { manufacturer } : {}),
        ...(model ? { model } : {}),
      },
    ];
  });
}

function floorCandidates(value: unknown): Candidate[] {
  return records(value).flatMap((entry) => {
    const id = stringValue(entry, "floor_id") ?? stringValue(entry, "id");
    const name = stringValue(entry, "name");
    if (!id || !name) return [];
    const aliases = stringList(entry.aliases);
    const level = typeof entry.level === "number" ? entry.level : undefined;
    return [
      {
        kind: "floor" as const,
        id,
        name,
        ...(aliases.length > 0 ? { aliases } : {}),
        ...(level === undefined ? {} : { level }),
        searchAliases: aliases,
      },
    ];
  });
}

function labelCandidates(value: unknown): Candidate[] {
  return records(value).flatMap((entry) => {
    const id = stringValue(entry, "label_id") ?? stringValue(entry, "id");
    const name = stringValue(entry, "name");
    if (!id || !name) return [];
    const description = stringValue(entry, "description");
    return [
      {
        kind: "label" as const,
        id,
        name,
        ...(description ? { description: description.slice(0, 500) } : {}),
      },
    ];
  });
}

function errorFromOutcome(outcome: CommandOutcome | undefined) {
  return outcome && !outcome.ok ? outcome.error : undefined;
}

function validCatalog(kind: DiscoveryKind, value: unknown): boolean {
  return kind === "action"
    ? asRecord(value) !== undefined
    : Array.isArray(value);
}

export async function discover(
  config: PluginConfig,
  options: {
    query?: string;
    kinds?: DiscoveryKind[];
    domains?: string[];
    states?: string[];
    signal?: AbortSignal;
  },
): Promise<DiscoveryResult> {
  const requestedKinds = options.kinds ?? ALL_KINDS;
  const requested = new Set(requestedKinds);
  const available = new Set<DiscoveryKind>();
  const unavailable = new Set<DiscoveryKind>();
  const candidates: Candidate[] = [];
  const errors: InterfaceError[] = [];

  const statePromise = requested.has("entity")
    ? new HomeAssistantClient(config).getAllStates(options.signal)
    : Promise.resolve<HaState[]>([]);

  const commandSpecs: Array<{
    kind?: DiscoveryKind;
    enrichment?: "entity_registry";
    command: WebSocketCommand;
  }> = [];
  if (requested.has("entity")) {
    commandSpecs.push({
      enrichment: "entity_registry",
      command: { type: "config/entity_registry/list" },
    });
  }
  if (requested.has("action")) {
    commandSpecs.push({ kind: "action", command: { type: "get_services" } });
  }
  if (requested.has("area")) {
    commandSpecs.push({
      kind: "area",
      command: { type: "config/area_registry/list" },
    });
  }
  if (requested.has("device")) {
    commandSpecs.push({
      kind: "device",
      command: { type: "config/device_registry/list" },
    });
  }
  if (requested.has("floor")) {
    commandSpecs.push({
      kind: "floor",
      command: { type: "config/floor_registry/list" },
    });
  }
  if (requested.has("label")) {
    commandSpecs.push({
      kind: "label",
      command: { type: "config/label_registry/list" },
    });
  }

  const socketPromise = commandSpecs.length
    ? new HomeAssistantWebSocketClient(config).runCommandsSettled(
        commandSpecs.map((item) => item.command),
        options.signal,
      )
    : Promise.resolve<CommandOutcome[]>([]);
  const [stateResult, socketResult] = await Promise.allSettled([
    statePromise,
    socketPromise,
  ]);

  let states: HaState[] = [];
  if (requested.has("entity")) {
    if (stateResult.status === "fulfilled") {
      states = stateResult.value;
      available.add("entity");
    } else {
      unavailable.add("entity");
      if (stateResult.reason instanceof InterfaceError) {
        errors.push(stateResult.reason);
      }
    }
  }

  let outcomes: CommandOutcome[] = [];
  if (socketResult.status === "fulfilled") {
    outcomes = socketResult.value;
  } else {
    if (socketResult.reason instanceof InterfaceError) {
      errors.push(socketResult.reason);
    }
    for (const spec of commandSpecs) {
      if (spec.kind) unavailable.add(spec.kind);
    }
  }

  const entityRegistryIndex = commandSpecs.findIndex(
    (item) => item.enrichment === "entity_registry",
  );
  const entityRegistryOutcome = outcomes[entityRegistryIndex];
  const entityRegistry =
    entityRegistryOutcome?.ok === true
      ? entityRegistryOutcome.value
      : undefined;
  if (available.has("entity")) {
    candidates.push(...entityCandidates(states, entityRegistry));
  }

  commandSpecs.forEach((spec, index) => {
    if (!spec.kind) return;
    const outcome = outcomes[index];
    if (!outcome || !outcome.ok) {
      unavailable.add(spec.kind);
      const error = errorFromOutcome(outcome);
      if (error) errors.push(error);
      return;
    }
    if (!validCatalog(spec.kind, outcome.value)) {
      unavailable.add(spec.kind);
      errors.push(
        new InterfaceError(
          "UPSTREAM_INVALID_RESPONSE",
          `Home Assistant returned an invalid ${spec.kind} catalog.`,
        ),
      );
      return;
    }
    available.add(spec.kind);
    switch (spec.kind) {
      case "action":
        candidates.push(...actionCandidates(outcome.value));
        break;
      case "area":
        candidates.push(...areaCandidates(outcome.value));
        break;
      case "device":
        candidates.push(...deviceCandidates(outcome.value));
        break;
      case "floor":
        candidates.push(...floorCandidates(outcome.value));
        break;
      case "label":
        candidates.push(...labelCandidates(outcome.value));
        break;
      case "entity":
        break;
    }
  });

  for (const kind of available) unavailable.delete(kind);
  if (available.size === 0 && errors[0]) throw errors[0];

  const domains = new Set(options.domains?.map((item) => item.toLowerCase()));
  const statesFilter = new Set(
    options.states?.map((item) => item.toLowerCase()),
  );
  const matches = candidates
    .filter(
      (candidate) =>
        domains.size === 0 ||
        candidate.domain === undefined ||
        domains.has(candidate.domain.toLowerCase()),
    )
    .filter(
      (candidate) =>
        statesFilter.size === 0 ||
        candidate.kind !== "entity" ||
        (candidate.state !== undefined &&
          statesFilter.has(candidate.state.toLowerCase())),
    )
    .flatMap((candidate) => {
      const scored = match(candidate, options.query?.trim() ?? "");
      return scored ? [scored] : [];
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.kind.localeCompare(right.kind) ||
        left.id.localeCompare(right.id),
    );

  return {
    matches,
    availableKinds: requestedKinds.filter((kind) => available.has(kind)),
    unavailableKinds: requestedKinds.filter((kind) => unavailable.has(kind)),
  };
}
