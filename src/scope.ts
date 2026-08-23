import type { HaState, UnresolvedTarget } from "./types.js";
import { HomeAssistantClient } from "./client.js";
import { InterfaceError } from "./errors.js";

const ENTITY_ID_PATTERN = /^[a-z0-9_]+\.[a-z0-9_]+$/;

export function entityDomain(entityId: string): string {
  return entityId.split(".", 1)[0] ?? "";
}

export function isEntityId(value: string): boolean {
  return ENTITY_ID_PATTERN.test(value);
}

function friendlyName(state: HaState): string {
  const value = state.attributes.friendly_name;
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : state.entity_id;
}

function normalizedWords(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/\s+/g, " ").trim();
}

function matchScore(target: string, state: HaState): number {
  const query = normalizedWords(target);
  const entityId = state.entity_id.toLowerCase();
  const objectName = normalizedWords(entityId.slice(entityId.indexOf(".") + 1));
  const name = normalizedWords(friendlyName(state));
  if (query === entityId) return 100;
  if (query === name) return 95;
  if (query === objectName) return 90;
  if (name.startsWith(query)) return 75;
  if (objectName.startsWith(query)) return 70;
  if (entityId.includes(query)) return 60;
  if (name.includes(query)) return 55;
  return 0;
}

export type ResolvedTargets = {
  resolved: HaState[];
  unresolved: UnresolvedTarget[];
};

async function resolveExactTargets(
  client: HomeAssistantClient,
  targets: string[],
  signal?: AbortSignal,
): Promise<ResolvedTargets> {
  const resolved: HaState[] = [];
  const unresolved: UnresolvedTarget[] = [];
  await Promise.all(
    targets.map(async (target) => {
      const normalized = target.toLowerCase();
      try {
        resolved.push(await client.getState(normalized, signal));
      } catch (error) {
        if (error instanceof InterfaceError && error.code === "NOT_FOUND") {
          unresolved.push({ target, reason: "not_found" });
          return;
        }
        if (
          error instanceof InterfaceError &&
          error.code === "UPSTREAM_UNAVAILABLE"
        ) {
          unresolved.push({ target, reason: "unavailable" });
          return;
        }
        throw error;
      }
    }),
  );
  const order = new Map(
    targets.map((target, index) => [target.toLowerCase(), index]),
  );
  resolved.sort(
    (left, right) =>
      (order.get(left.entity_id.toLowerCase()) ?? 0) -
      (order.get(right.entity_id.toLowerCase()) ?? 0),
  );
  unresolved.sort(
    (left, right) =>
      (order.get(left.target.toLowerCase()) ?? 0) -
      (order.get(right.target.toLowerCase()) ?? 0),
  );
  return { resolved, unresolved };
}

export async function resolveTargets(
  client: HomeAssistantClient,
  rawTargets: string[],
  signal?: AbortSignal,
): Promise<ResolvedTargets> {
  const targets = [
    ...new Set(rawTargets.map((value) => value.trim()).filter(Boolean)),
  ];
  if (targets.length === 0) {
    throw new InterfaceError(
      "INVALID_INPUT",
      "Provide at least one Home Assistant target.",
      {
        recovery: { action: "narrow_request" },
      },
    );
  }
  if (targets.every((target) => isEntityId(target.toLowerCase()))) {
    return resolveExactTargets(client, targets, signal);
  }

  const states = await client.getAllStates(signal);
  const resolved: HaState[] = [];
  const unresolved: UnresolvedTarget[] = [];
  const used = new Set<string>();

  for (const target of targets) {
    const ranked = states
      .map((state) => ({ state, score: matchScore(target, state) }))
      .filter(({ score }) => score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.state.entity_id.localeCompare(right.state.entity_id),
      );
    const bestScore = ranked[0]?.score;
    if (bestScore === undefined) {
      unresolved.push({ target, reason: "not_found" });
      continue;
    }
    const best = ranked.filter(({ score }) => score === bestScore);
    if (best.length > 1) {
      unresolved.push({
        target,
        reason: "ambiguous",
        candidate_entity_ids: best
          .slice(0, 8)
          .map(({ state }) => state.entity_id),
      });
      continue;
    }
    const state = best[0]?.state;
    if (state && !used.has(state.entity_id)) {
      used.add(state.entity_id);
      resolved.push(state);
    }
  }
  return { resolved, unresolved };
}

export type FindMatch = {
  entity_id: string;
  name: string;
  domain: string;
  state: string;
  matched_on: "entity_id" | "name";
  score: number;
};

export function findMatches(
  states: HaState[],
  query: string,
  domains?: string[],
  statesFilter?: string[],
): FindMatch[] {
  const domainSet = new Set(domains?.map((value) => value.toLowerCase()) ?? []);
  const stateSet = new Set(
    statesFilter?.map((value) => value.toLowerCase()) ?? [],
  );
  const normalizedQuery = normalizedWords(query);
  return states
    .filter(
      (state) =>
        domainSet.size === 0 || domainSet.has(entityDomain(state.entity_id)),
    )
    .filter(
      (state) => stateSet.size === 0 || stateSet.has(state.state.toLowerCase()),
    )
    .map((state) => {
      const score = matchScore(normalizedQuery, state);
      const name = friendlyName(state);
      const nameScore = normalizedWords(name).includes(normalizedQuery);
      return {
        entity_id: state.entity_id,
        name,
        domain: entityDomain(state.entity_id),
        state: state.state,
        matched_on: nameScore ? ("name" as const) : ("entity_id" as const),
        score,
      };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.entity_id.localeCompare(right.entity_id),
    );
}
