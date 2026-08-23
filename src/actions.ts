import { HomeAssistantClient } from "./client.js";
import { compactJson } from "./compact.js";
import { InterfaceError } from "./errors.js";
import { projectState } from "./projection.js";
import type { HaState, HaTarget, PluginConfig } from "./types.js";
import { HomeAssistantWebSocketClient } from "./websocket.js";

export type ExecuteActionParameters = {
  action: string;
  target?: HaTarget;
  data?: Record<string, unknown>;
  return_response?: boolean;
  observe?: boolean;
  settle_ms?: number;
  poll_interval_ms?: number;
};

type MissingTarget = {
  kind: "device" | "area" | "floor" | "label";
  id: string;
};

type ObservationItem = {
  entity_id: string;
  changed: boolean;
  before?: ReturnType<typeof projectState>;
  after?: ReturnType<typeof projectState>;
};

const DEFAULT_OBSERVATION_SETTLE_MS = 1_500;
const DEFAULT_OBSERVATION_POLL_MS = 250;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function targetEntityIds(value: unknown): string[] {
  return unique(strings(asRecord(value)?.referenced_entities));
}

function missingTargets(value: unknown): MissingTarget[] {
  const record = asRecord(value);
  if (!record) return [];
  const mappings = [
    ["missing_devices", "device"],
    ["missing_areas", "area"],
    ["missing_floors", "floor"],
    ["missing_labels", "label"],
  ] as const;
  return mappings.flatMap(([key, kind]) =>
    strings(record[key]).map((id) => ({ kind, id })),
  );
}

function actionParts(action: string): { domain: string; service: string } {
  const [domain, service, ...rest] = action.toLowerCase().split(".");
  if (!domain || !service || rest.length > 0) {
    throw new InterfaceError(
      "INVALID_INPUT",
      "Action must use the domain.action format.",
      {
        recovery: { action: "narrow_request", tool: "home_assistant_execute" },
      },
    );
  }
  return { domain, service };
}

function stateMap(states: HaState[], ids: string[]): Map<string, HaState> {
  const selected = new Set(ids);
  return new Map(
    states
      .filter((state) => selected.has(state.entity_id))
      .map((state) => [state.entity_id, state]),
  );
}

function stateChanged(before: HaState | undefined, after: HaState | undefined) {
  if (!before || !after) return before !== after;
  return (
    before.state !== after.state ||
    before.last_changed !== after.last_changed ||
    before.last_updated !== after.last_updated ||
    JSON.stringify(before.attributes) !== JSON.stringify(after.attributes)
  );
}

function anyStateChanged(
  before: Map<string, HaState>,
  after: Map<string, HaState>,
  entityIds: string[],
) {
  return entityIds.some((entityId) =>
    stateChanged(before.get(entityId), after.get(entityId)),
  );
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(
      new InterfaceError(
        "REQUEST_ABORTED",
        "Home Assistant request was cancelled.",
      ),
    );
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(
        new InterfaceError(
          "REQUEST_ABORTED",
          "Home Assistant request was cancelled.",
        ),
      );
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

async function readObservedStates(
  config: PluginConfig,
  entityIds: string[],
  signal?: AbortSignal,
): Promise<Map<string, HaState> | undefined> {
  if (entityIds.length === 0) return new Map();
  try {
    const states = await new HomeAssistantClient(config).getAllStates(signal);
    return stateMap(states, entityIds);
  } catch (error) {
    if (error instanceof InterfaceError && error.code === "REQUEST_ABORTED") {
      throw error;
    }
    return undefined;
  }
}

async function settleObservation(
  config: PluginConfig,
  entityIds: string[],
  before: Map<string, HaState>,
  settleMs: number,
  pollMs: number,
  signal?: AbortSignal,
) {
  const started = Date.now();
  const deadline = started + settleMs;
  let attempts = 0;
  let after: Map<string, HaState> | undefined;

  while (true) {
    attempts += 1;
    const current = await readObservedStates(config, entityIds, signal);
    if (current !== undefined) {
      after = current;
      if (anyStateChanged(before, current, entityIds)) break;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await wait(Math.min(pollMs, remaining), signal);
  }

  return {
    after,
    attempts,
    waitedMs: Math.max(0, Date.now() - started),
  };
}

export async function executeAction(
  params: ExecuteActionParameters,
  config: PluginConfig,
  signal?: AbortSignal,
) {
  const started = Date.now();
  const { domain, service } = actionParts(params.action);
  const target = params.target;
  const shouldObserve = params.observe !== false;
  const socketClient = new HomeAssistantWebSocketClient(config);
  const settleMs =
    params.settle_ms ??
    config.observationSettleMs ??
    DEFAULT_OBSERVATION_SETTLE_MS;
  const pollMs =
    params.poll_interval_ms ??
    config.observationPollMs ??
    DEFAULT_OBSERVATION_POLL_MS;
  let entityIds = shouldObserve ? unique(target?.entity_id ?? []) : [];
  let missing: MissingTarget[] = [];
  let resolutionAvailable = true;

  const hasSemanticTargets = Boolean(
    target?.device_id?.length ||
    target?.area_id?.length ||
    target?.floor_id?.length ||
    target?.label_id?.length,
  );
  if (shouldObserve && target && hasSemanticTargets) {
    try {
      const extracted = await socketClient.runCommand(
        {
          type: "extract_from_target",
          target,
          expand_group: true,
          primary_entities_only: false,
        },
        signal,
      );
      entityIds = unique([...entityIds, ...targetEntityIds(extracted)]);
      missing = missingTargets(extracted);
    } catch (error) {
      if (error instanceof InterfaceError && error.code === "REQUEST_ABORTED") {
        throw error;
      }
      resolutionAvailable = false;
    }
  }

  const before = shouldObserve
    ? await readObservedStates(config, entityIds, signal)
    : undefined;
  const result = await socketClient.runCommand(
    {
      type: "call_service",
      domain,
      service,
      ...(target ? { target } : {}),
      ...(params.data ? { service_data: params.data } : {}),
      return_response: params.return_response ?? false,
    },
    signal,
  );
  const settled =
    before === undefined || entityIds.length === 0
      ? { after: undefined, attempts: 0, waitedMs: 0 }
      : await settleObservation(
          config,
          entityIds,
          before,
          settleMs,
          pollMs,
          signal,
        );
  const after = settled.after;

  const resultRecord = asRecord(result);
  const contextRecord = asRecord(resultRecord?.context);
  const contextId = contextRecord?.id;
  const observationItems: ObservationItem[] = [];
  if (before && after) {
    for (const entityId of entityIds) {
      const beforeState = before.get(entityId);
      const afterState = after.get(entityId);
      observationItems.push({
        entity_id: entityId,
        changed: stateChanged(beforeState, afterState),
        ...(beforeState ? { before: projectState(beforeState, "detail") } : {}),
        ...(afterState ? { after: projectState(afterState, "detail") } : {}),
      });
    }
  }
  const selectedItems = observationItems.slice(0, 25);
  const observationStatus =
    !shouldObserve || entityIds.length === 0
      ? "not_applicable"
      : resolutionAvailable && before !== undefined && after !== undefined
        ? "observed"
        : "unavailable";
  const observationOutcome =
    observationStatus === "observed"
      ? observationItems.some((item) => item.changed)
        ? ("changed" as const)
        : ("no_change_observed" as const)
      : undefined;
  const response = compactJson(resultRecord?.response);

  return {
    ok: true as const,
    action: `${domain}.${service}`,
    duration_ms: Math.max(0, Date.now() - started),
    ...(target ? { target } : {}),
    ...(typeof contextId === "string" ? { context_id: contextId } : {}),
    ...(params.return_response === true && resultRecord
      ? {
          response: response.value,
          response_truncated: response.truncated,
        }
      : {}),
    observation: {
      status: observationStatus,
      ...(observationOutcome ? { outcome: observationOutcome } : {}),
      settle_ms: settleMs,
      waited_ms: settled.waitedMs,
      attempts: settled.attempts,
      total: entityIds.length,
      returned: selectedItems.length,
      truncated: selectedItems.length < observationItems.length,
      changed: observationItems.filter((item) => item.changed).length,
      items: selectedItems,
    },
    missing_targets: missing,
  };
}
