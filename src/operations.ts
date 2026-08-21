import type { Static } from "typebox";
import { HomeAssistantClient } from "./client.js";
import { InterfaceError, toolResult } from "./errors.js";
import {
  attentionForState,
  projectState,
  type DetailLevel,
} from "./projection.js";
import {
  briefParameters,
  diagnoseParameters,
  findParameters,
  inspectParameters,
  presenceParameters,
} from "./schemas.js";
import {
  entityDomain,
  findMatches,
  isEntityAllowed,
  resolveTargets,
} from "./scope.js";
import type {
  ErrorResult,
  HaHistoryState,
  HaState,
  PluginConfig,
  UnresolvedTarget,
} from "./types.js";

type ExecutionContext = {
  signal?: AbortSignal;
};

type BriefParameters = Static<typeof briefParameters>;
type FindParameters = Static<typeof findParameters>;
type InspectParameters = Static<typeof inspectParameters>;
type PresenceParameters = Static<typeof presenceParameters>;
type DiagnoseParameters = Static<typeof diagnoseParameters>;

const DEFAULT_BRIEF_ITEMS = 12;
const DEFAULT_RECENT_MINUTES = 60;
const DEFAULT_HISTORY_HOURS = 24;
const DEFAULT_MAX_HISTORY_HOURS = 168;
const DEFAULT_MAX_TRANSITIONS = 20;

function client(config: PluginConfig): HomeAssistantClient {
  return new HomeAssistantClient(config);
}

function configuredTargets(
  supplied: string[] | undefined,
  configured: string[] | undefined,
  configField: "briefEntities" | "presenceEntities",
): string[] {
  const targets = supplied ?? configured;
  if (!targets || targets.length === 0) {
    throw new InterfaceError(
      "CONFIG_REQUIRED",
      `Provide targets or configure ${configField} for this tool.`,
      { recovery: { action: "configure_plugin", fields: [configField] } },
    );
  }
  return targets;
}

function bounded<T>(items: T[], limit: number) {
  const selected = items.slice(0, limit);
  return {
    total: items.length,
    returned: selected.length,
    truncated: selected.length < items.length,
    items: selected,
  };
}

export async function runBrief(
  params: BriefParameters,
  config: PluginConfig,
  context: ExecutionContext = {},
) {
  return toolResult(async () => {
    const targets = configuredTargets(
      params.targets,
      config.briefEntities,
      "briefEntities",
    );
    const now = new Date();
    const resolution = await resolveTargets(
      client(config),
      targets,
      config,
      context.signal,
    );
    const entities = resolution.resolved.map((state) =>
      projectState(state, "summary", now),
    );
    const attention = resolution.resolved
      .map(attentionForState)
      .filter((item) => item !== undefined)
      .sort((left, right) =>
        left.severity === right.severity
          ? left.entity_id.localeCompare(right.entity_id)
          : left.severity === "critical"
            ? -1
            : 1,
      );
    const presence = resolution.resolved
      .filter((state) =>
        ["device_tracker", "person"].includes(entityDomain(state.entity_id)),
      )
      .map((state) => projectState(state, "detail", now));
    const recentSeconds =
      (config.recentChangeMinutes ?? DEFAULT_RECENT_MINUTES) * 60;
    const recent = entities
      .filter((entity) => entity.changed_seconds_ago <= recentSeconds)
      .sort(
        (left, right) => left.changed_seconds_ago - right.changed_seconds_ago,
      );
    const maxItems = config.maxBriefItems ?? DEFAULT_BRIEF_ITEMS;
    const available = entities.filter((entity) => entity.available).length;
    return {
      ok: true as const,
      generated_at: now.toISOString(),
      scope: { requested: targets.length, resolved: entities.length },
      counts: {
        available,
        unavailable: entities.length - available,
        attention: attention.length,
        presence: presence.length,
        changed_recently: recent.length,
      },
      entities,
      attention: bounded(attention, maxItems),
      presence: presence.slice(0, maxItems),
      recent_changes: bounded(recent, maxItems),
      unresolved: resolution.unresolved,
    };
  });
}

export async function runFind(
  params: FindParameters,
  config: PluginConfig,
  context: ExecutionContext = {},
) {
  return toolResult(async () => {
    const all = await client(config).getAllStates(context.signal);
    const matches = findMatches(
      all,
      params.query,
      config,
      params.domains,
      params.states,
    );
    const limit = params.limit ?? 10;
    const offset = params.cursor === undefined ? 0 : Number(params.cursor);
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new InterfaceError(
        "INVALID_INPUT",
        "cursor must be a non-negative integer.",
        {
          recovery: { action: "narrow_request", tool: "home_assistant_find" },
        },
      );
    }
    const page = matches
      .slice(offset, offset + limit)
      .map(({ score: _score, ...match }) => match);
    const nextOffset = offset + page.length;
    return {
      ok: true as const,
      query: params.query,
      total: matches.length,
      returned: page.length,
      truncated: nextOffset < matches.length,
      ...(nextOffset < matches.length
        ? { next_cursor: String(nextOffset) }
        : {}),
      matches: page,
    };
  });
}

export async function runInspect(
  params: InspectParameters,
  config: PluginConfig,
  context: ExecutionContext = {},
) {
  return toolResult(async () => {
    const detail: DetailLevel = params.detail ?? "detail";
    const resolution = await resolveTargets(
      client(config),
      params.targets,
      config,
      context.signal,
    );
    const entities = resolution.resolved.map((state) =>
      projectState(state, detail),
    );
    return {
      ok: true as const,
      detail,
      total: params.targets.length,
      returned: entities.length,
      entities,
      unresolved: resolution.unresolved,
    };
  });
}

type TimelinePoint = { state: string; at: number };

function historyGroupFor(
  groups: HaHistoryState[][],
  entityId: string,
  requestedIndex: number,
): HaHistoryState[] {
  const explicit = groups.find((group) =>
    group.some((item) => item.entity_id === entityId),
  );
  if (explicit) return explicit;
  const positional = groups[requestedIndex];
  if (!positional || positional.some((item) => item.entity_id !== undefined))
    return [];
  return positional;
}

function buildTimeline(group: HaHistoryState[]): TimelinePoint[] {
  const sorted = group
    .map((item) => ({ state: item.state, at: Date.parse(item.last_changed) }))
    .filter((item) => Number.isFinite(item.at))
    .sort((left, right) => left.at - right.at);
  const deduplicated: TimelinePoint[] = [];
  for (const point of sorted) {
    const previous = deduplicated.at(-1);
    if (previous?.state === point.state) continue;
    deduplicated.push(point);
  }
  return deduplicated;
}

function summarizeWindow(
  group: HaHistoryState[],
  start: Date,
  end: Date,
  maxTransitions: number,
) {
  const timeline = buildTimeline(group);
  const transitions = timeline
    .slice(1)
    .filter((point) => point.at >= start.getTime() && point.at <= end.getTime())
    .map((point, index) => {
      const timelineIndex = timeline.indexOf(point);
      return {
        at: new Date(point.at).toISOString(),
        from:
          timeline[timelineIndex - 1]?.state ??
          timeline[index]?.state ??
          "unknown",
        to: point.state,
      };
    });

  const durations = new Map<string, number>();
  for (const [index, point] of timeline.entries()) {
    const segmentStart = Math.max(point.at, start.getTime());
    const next = timeline[index + 1]?.at ?? end.getTime();
    const segmentEnd = Math.min(next, end.getTime());
    if (segmentEnd <= segmentStart) continue;
    durations.set(
      point.state,
      (durations.get(point.state) ?? 0) + (segmentEnd - segmentStart) / 1000,
    );
  }
  const observedSeconds = [...durations.values()].reduce(
    (total, value) => total + value,
    0,
  );
  const timeByZone = [...durations.entries()]
    .map(([zone, seconds]) => ({
      zone,
      seconds: Math.round(seconds),
      percent:
        observedSeconds === 0
          ? 0
          : Math.round((seconds / observedSeconds) * 10_000) / 100,
    }))
    .sort(
      (left, right) =>
        right.seconds - left.seconds || left.zone.localeCompare(right.zone),
    );
  const selected = transitions.slice(-maxTransitions);
  return {
    observed: timeline.length > 0,
    transitions: {
      total: transitions.length,
      returned: selected.length,
      truncated: selected.length < transitions.length,
      items: selected,
    },
    time_by_zone: timeByZone,
  };
}

function presenceWindow(
  params: PresenceParameters,
  config: PluginConfig,
): { start: Date; end: Date } {
  if (params.start !== undefined && params.hours !== undefined) {
    throw new InterfaceError(
      "INVALID_INPUT",
      "Use either start or hours, not both.",
      {
        recovery: { action: "narrow_request", tool: "home_assistant_presence" },
      },
    );
  }
  const end = params.end === undefined ? new Date() : new Date(params.end);
  const hours =
    params.hours ?? config.defaultHistoryHours ?? DEFAULT_HISTORY_HOURS;
  const start =
    params.start === undefined
      ? new Date(end.getTime() - hours * 3_600_000)
      : new Date(params.start);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    start >= end
  ) {
    throw new InterfaceError(
      "INVALID_INPUT",
      "Provide a valid history window with start before end.",
      {
        recovery: { action: "narrow_request", tool: "home_assistant_presence" },
      },
    );
  }
  const requestedHours = (end.getTime() - start.getTime()) / 3_600_000;
  const maxHours = config.maxHistoryHours ?? DEFAULT_MAX_HISTORY_HOURS;
  if (requestedHours > maxHours) {
    throw new InterfaceError(
      "INVALID_INPUT",
      `Presence history is limited to ${maxHours} hours by plugin configuration.`,
      {
        recovery: { action: "narrow_request", tool: "home_assistant_presence" },
      },
    );
  }
  return { start, end };
}

function sourceFor(state: HaState, config: PluginConfig): string | undefined {
  const source = state.attributes.source;
  return typeof source === "string" && isEntityAllowed(source, config)
    ? source
    : undefined;
}

export async function runPresence(
  params: PresenceParameters,
  config: PluginConfig,
  context: ExecutionContext = {},
) {
  return toolResult(async () => {
    const targets = configuredTargets(
      params.targets,
      config.presenceEntities,
      "presenceEntities",
    );
    const resolution = await resolveTargets(
      client(config),
      targets,
      config,
      context.signal,
    );
    const supported: HaState[] = [];
    const unsupported: UnresolvedTarget[] = [];
    for (const state of resolution.resolved) {
      if (["device_tracker", "person"].includes(entityDomain(state.entity_id)))
        supported.push(state);
      else unsupported.push({ target: state.entity_id, reason: "unsupported" });
    }
    if (supported.length === 0 && unsupported.length > 0) {
      throw new InterfaceError(
        "INVALID_INPUT",
        "Presence targets must be person or device_tracker entities.",
        { recovery: { action: "choose_target", tool: "home_assistant_find" } },
      );
    }

    const window = presenceWindow(params, config);
    const entityIds = supported.map((state) => state.entity_id);
    const groups =
      entityIds.length === 0
        ? []
        : await client(config).getHistory(
            entityIds,
            window.start.toISOString(),
            window.end.toISOString(),
            context.signal,
          );
    const maxTransitions = params.max_transitions ?? DEFAULT_MAX_TRANSITIONS;
    const people = supported.map((state, index) => {
      const summary = summarizeWindow(
        historyGroupFor(groups, state.entity_id, index),
        window.start,
        window.end,
        maxTransitions,
      );
      const source = sourceFor(state, config);
      const projection = projectState(state, "summary");
      return {
        entity_id: state.entity_id,
        name: projection.name,
        current: {
          zone: state.state,
          since: state.last_changed,
          ...(source === undefined ? {} : { source }),
        },
        window: {
          start: window.start.toISOString(),
          end: window.end.toISOString(),
          ...summary,
        },
      };
    });
    return {
      ok: true as const,
      total: targets.length,
      returned: people.length,
      people,
      unresolved: [...resolution.unresolved, ...unsupported],
    };
  });
}

export async function runDiagnose(
  _params: DiagnoseParameters,
  config: PluginConfig,
  context: ExecutionContext = {},
): Promise<
  | {
      ok: true;
      checked_at: string;
      connection: { reachable: true; latency_ms: number };
      instance: {
        version?: string;
        state?: string;
        time_zone?: string;
        recorder_available: boolean;
        history_available: boolean;
      };
      entities: {
        total: number;
        available: number;
        unavailable: number;
        unknown: number;
        by_domain: { domain: string; count: number }[];
      };
      issues: ReturnType<
        typeof bounded<NonNullable<ReturnType<typeof attentionForState>>>
      >;
    }
  | ErrorResult
> {
  return toolResult(async () => {
    const started = Date.now();
    const haClient = client(config);
    const [instance, allStates] = await Promise.all([
      haClient.getConfig(context.signal),
      haClient.getAllStates(context.signal),
    ]);
    const states = allStates.filter((state) =>
      isEntityAllowed(state.entity_id, config),
    );
    const domainCounts = new Map<string, number>();
    for (const state of states) {
      const domain = entityDomain(state.entity_id);
      domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
    }
    const unavailable = states.filter(
      (state) => state.state === "unavailable",
    ).length;
    const unknown = states.filter((state) => state.state === "unknown").length;
    const issues = states
      .map(attentionForState)
      .filter((item) => item !== undefined)
      .sort((left, right) =>
        left.severity === right.severity
          ? left.entity_id.localeCompare(right.entity_id)
          : left.severity === "critical"
            ? -1
            : 1,
      );
    const components = new Set(instance.components ?? []);
    const maxItems = config.maxBriefItems ?? DEFAULT_BRIEF_ITEMS;
    return {
      ok: true as const,
      checked_at: new Date().toISOString(),
      connection: {
        reachable: true as const,
        latency_ms: Math.max(0, Date.now() - started),
      },
      instance: {
        ...(instance.version === undefined
          ? {}
          : { version: instance.version }),
        ...(instance.state === undefined ? {} : { state: instance.state }),
        ...(instance.time_zone === undefined
          ? {}
          : { time_zone: instance.time_zone }),
        recorder_available: components.has("recorder"),
        history_available:
          components.has("history") && components.has("recorder"),
      },
      entities: {
        total: states.length,
        available: states.length - unavailable - unknown,
        unavailable,
        unknown,
        by_domain: [...domainCounts.entries()]
          .map(([domain, count]) => ({ domain, count }))
          .sort(
            (left, right) =>
              right.count - left.count ||
              left.domain.localeCompare(right.domain),
          ),
      },
      issues: bounded(issues, maxItems),
    };
  });
}
