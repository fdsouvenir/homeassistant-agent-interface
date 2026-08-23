import { Type } from "typebox";

const strict = { additionalProperties: false } as const;
const entityId = Type.String({
  minLength: 3,
  maxLength: 255,
  pattern: "^[a-z0-9_]+\\.[a-z0-9_]+$",
});
const target = Type.String({ minLength: 1, maxLength: 255 });
const stringList = Type.Array(Type.String({ minLength: 1, maxLength: 255 }), {
  maxItems: 100,
  uniqueItems: true,
});

export const configSchema = Type.Object(
  {
    baseUrl: Type.String({
      minLength: 1,
      description: "Home Assistant base URL.",
    }),
    token: Type.String({
      minLength: 1,
      description: "Home Assistant access token or SecretRef.",
    }),
    briefEntities: Type.Optional(
      Type.Array(entityId, {
        maxItems: 25,
        uniqueItems: true,
        description:
          "Entity IDs used when home_assistant_brief receives no targets.",
      }),
    ),
    presenceEntities: Type.Optional(
      Type.Array(entityId, {
        maxItems: 25,
        uniqueItems: true,
        description:
          "Presence entity IDs used when home_assistant_presence receives no targets.",
      }),
    ),
    requestTimeoutMs: Type.Optional(
      Type.Integer({ minimum: 1_000, maximum: 60_000 }),
    ),
    maxResponseBytes: Type.Optional(
      Type.Integer({ minimum: 65_536, maximum: 16_777_216 }),
    ),
    maxBriefItems: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    recentChangeMinutes: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 1_440 }),
    ),
    defaultHistoryHours: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 720 }),
    ),
    maxHistoryHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 720 })),
    observationSettleMs: Type.Optional(
      Type.Integer({
        minimum: 0,
        maximum: 10_000,
        description:
          "Default post-action observation settle window in milliseconds. Defaults to 1500.",
      }),
    ),
    observationPollMs: Type.Optional(
      Type.Integer({
        minimum: 100,
        maximum: 2_000,
        description:
          "Default interval between post-action observation reads in milliseconds. Defaults to 250.",
      }),
    ),
  },
  strict,
);

const recoverySchema = Type.Object(
  {
    action: Type.Union([
      Type.Literal("choose_target"),
      Type.Literal("configure_plugin"),
      Type.Literal("narrow_request"),
      Type.Literal("retry"),
    ]),
    tool: Type.Optional(Type.String()),
    fields: Type.Optional(Type.Array(Type.String())),
    candidate_entity_ids: Type.Optional(Type.Array(entityId)),
  },
  strict,
);

export const errorSchema = Type.Object(
  {
    ok: Type.Literal(false),
    error: Type.Object(
      {
        code: Type.Union([
          Type.Literal("ACCESS_DENIED"),
          Type.Literal("AMBIGUOUS_TARGET"),
          Type.Literal("AUTH_FAILED"),
          Type.Literal("CONFIG_REQUIRED"),
          Type.Literal("INVALID_INPUT"),
          Type.Literal("NOT_FOUND"),
          Type.Literal("REQUEST_ABORTED"),
          Type.Literal("RESPONSE_TOO_LARGE"),
          Type.Literal("UPSTREAM_INVALID_RESPONSE"),
          Type.Literal("UPSTREAM_TIMEOUT"),
          Type.Literal("UPSTREAM_UNAVAILABLE"),
        ]),
        message: Type.String(),
        retryable: Type.Boolean(),
        recovery: Type.Optional(recoverySchema),
      },
      strict,
    ),
  },
  strict,
);

const factSchema = Type.Object(
  {
    key: Type.String(),
    value: Type.Union([
      Type.String(),
      Type.Number(),
      Type.Boolean(),
      Type.Null(),
    ]),
    unit: Type.Optional(Type.String()),
  },
  strict,
);

export const entityProjectionSchema = Type.Object(
  {
    entity_id: entityId,
    name: Type.String(),
    domain: Type.String(),
    state: Type.String(),
    available: Type.Boolean(),
    changed_at: Type.String(),
    changed_seconds_ago: Type.Integer({ minimum: 0 }),
    updated_at: Type.Optional(Type.String()),
    facts: Type.Optional(Type.Array(factSchema)),
    attributes: Type.Optional(
      Type.Record(Type.String(), Type.Unknown(), { maxProperties: 50 }),
    ),
    attributes_truncated: Type.Optional(Type.Boolean()),
  },
  strict,
);

export const unresolvedTargetSchema = Type.Object(
  {
    target,
    reason: Type.Union([
      Type.Literal("ambiguous"),
      Type.Literal("not_found"),
      Type.Literal("unavailable"),
      Type.Literal("unsupported"),
    ]),
    candidate_entity_ids: Type.Optional(Type.Array(entityId)),
  },
  strict,
);

const attentionItemSchema = Type.Object(
  {
    entity_id: entityId,
    name: Type.String(),
    severity: Type.Union([Type.Literal("critical"), Type.Literal("warning")]),
    reason: Type.Union([
      Type.Literal("alarm_triggered"),
      Type.Literal("low_battery"),
      Type.Literal("safety_active"),
      Type.Literal("unavailable"),
      Type.Literal("unknown"),
    ]),
    state: Type.String(),
  },
  strict,
);

const boundedCollection = <T extends ReturnType<typeof Type.Object>>(item: T) =>
  Type.Object(
    {
      total: Type.Integer({ minimum: 0 }),
      returned: Type.Integer({ minimum: 0 }),
      truncated: Type.Boolean(),
      items: Type.Array(item),
    },
    strict,
  );

export const briefParameters = Type.Object(
  {
    targets: Type.Optional(
      Type.Array(target, { minItems: 1, maxItems: 25, uniqueItems: true }),
    ),
  },
  strict,
);

export const briefOutputSchema = Type.Union([
  Type.Object(
    {
      ok: Type.Literal(true),
      generated_at: Type.String(),
      scope: Type.Object(
        {
          requested: Type.Integer({ minimum: 0 }),
          resolved: Type.Integer({ minimum: 0 }),
        },
        strict,
      ),
      counts: Type.Object(
        {
          available: Type.Integer({ minimum: 0 }),
          unavailable: Type.Integer({ minimum: 0 }),
          attention: Type.Integer({ minimum: 0 }),
          presence: Type.Integer({ minimum: 0 }),
          changed_recently: Type.Integer({ minimum: 0 }),
        },
        strict,
      ),
      entities: Type.Array(entityProjectionSchema),
      attention: boundedCollection(attentionItemSchema),
      presence: Type.Array(entityProjectionSchema),
      recent_changes: boundedCollection(entityProjectionSchema),
      unresolved: Type.Array(unresolvedTargetSchema),
    },
    strict,
  ),
  errorSchema,
]);

export const findParameters = Type.Object(
  {
    query: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    kinds: Type.Optional(
      Type.Array(
        Type.Union([
          Type.Literal("entity"),
          Type.Literal("action"),
          Type.Literal("area"),
          Type.Literal("device"),
          Type.Literal("floor"),
          Type.Literal("label"),
        ]),
        { minItems: 1, maxItems: 6, uniqueItems: true },
      ),
    ),
    domains: Type.Optional(
      Type.Array(Type.String({ pattern: "^[a-z0-9_]+$" }), { maxItems: 20 }),
    ),
    states: Type.Optional(stringList),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 25 })),
    cursor: Type.Optional(Type.String({ pattern: "^[0-9]+$" })),
  },
  strict,
);

const findMatchSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("entity"),
      Type.Literal("action"),
      Type.Literal("area"),
      Type.Literal("device"),
      Type.Literal("floor"),
      Type.Literal("label"),
    ]),
    id: Type.String(),
    name: Type.String(),
    matched_on: Type.Union([
      Type.Literal("all"),
      Type.Literal("id"),
      Type.Literal("name"),
      Type.Literal("alias"),
      Type.Literal("description"),
    ]),
    domain: Type.Optional(Type.String()),
    state: Type.Optional(Type.String()),
    area_id: Type.Optional(Type.String()),
    floor_id: Type.Optional(Type.String()),
    device_id: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    aliases: Type.Optional(Type.Array(Type.String())),
    fields: Type.Optional(Type.Array(Type.String())),
    field_details: Type.Optional(
      Type.Array(
        Type.Object(
          {
            name: Type.String(),
            required: Type.Boolean(),
            description: Type.Optional(Type.String()),
            selector: Type.Optional(Type.String()),
            example: Type.Optional(Type.Unknown()),
            default: Type.Optional(Type.Unknown()),
            options: Type.Optional(
              Type.Array(
                Type.Union([
                  Type.String(),
                  Type.Number(),
                  Type.Boolean(),
                  Type.Null(),
                ]),
              ),
            ),
          },
          strict,
        ),
      ),
    ),
    fields_truncated: Type.Optional(Type.Boolean()),
    target_supported: Type.Optional(Type.Boolean()),
    response: Type.Optional(
      Type.Union([
        Type.Literal("none"),
        Type.Literal("optional"),
        Type.Literal("required"),
      ]),
    ),
    manufacturer: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
    level: Type.Optional(Type.Number()),
  },
  strict,
);

export const findOutputSchema = Type.Union([
  Type.Object(
    {
      ok: Type.Literal(true),
      query: Type.Optional(Type.String()),
      coverage: Type.Object(
        {
          partial: Type.Boolean(),
          available_kinds: Type.Array(Type.String()),
          unavailable_kinds: Type.Array(Type.String()),
        },
        strict,
      ),
      total: Type.Integer({ minimum: 0 }),
      returned: Type.Integer({ minimum: 0 }),
      truncated: Type.Boolean(),
      next_cursor: Type.Optional(Type.String()),
      matches: Type.Array(findMatchSchema),
    },
    strict,
  ),
  errorSchema,
]);

export const inspectParameters = Type.Object(
  {
    targets: Type.Array(target, {
      minItems: 1,
      maxItems: 25,
      uniqueItems: true,
    }),
    detail: Type.Optional(
      Type.Union([
        Type.Literal("summary"),
        Type.Literal("detail"),
        Type.Literal("full"),
      ]),
    ),
    attribute_keys: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 100 }), {
        maxItems: 50,
        uniqueItems: true,
        description:
          "Exact Home Assistant attribute names to include when additional context is needed.",
      }),
    ),
  },
  strict,
);

export const inspectOutputSchema = Type.Union([
  Type.Object(
    {
      ok: Type.Literal(true),
      detail: Type.Union([
        Type.Literal("summary"),
        Type.Literal("detail"),
        Type.Literal("full"),
      ]),
      total: Type.Integer({ minimum: 0 }),
      returned: Type.Integer({ minimum: 0 }),
      entities: Type.Array(entityProjectionSchema),
      unresolved: Type.Array(unresolvedTargetSchema),
    },
    strict,
  ),
  errorSchema,
]);

export const presenceParameters = Type.Object(
  {
    targets: Type.Optional(
      Type.Array(target, { minItems: 1, maxItems: 25, uniqueItems: true }),
    ),
    hours: Type.Optional(Type.Integer({ minimum: 1, maximum: 720 })),
    start: Type.Optional(
      Type.String({ description: "ISO 8601 window start." }),
    ),
    end: Type.Optional(Type.String({ description: "ISO 8601 window end." })),
    max_transitions: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  strict,
);

const transitionSchema = Type.Object(
  {
    at: Type.String(),
    from: Type.String(),
    to: Type.String(),
  },
  strict,
);

const presenceItemSchema = Type.Object(
  {
    entity_id: entityId,
    name: Type.String(),
    current: Type.Object(
      {
        zone: Type.String(),
        since: Type.String(),
        source: Type.Optional(entityId),
      },
      strict,
    ),
    window: Type.Object(
      {
        start: Type.String(),
        end: Type.String(),
        observed: Type.Boolean(),
        transitions: Type.Object(
          {
            total: Type.Integer({ minimum: 0 }),
            returned: Type.Integer({ minimum: 0 }),
            truncated: Type.Boolean(),
            items: Type.Array(transitionSchema),
          },
          strict,
        ),
        time_by_zone: Type.Array(
          Type.Object(
            {
              zone: Type.String(),
              seconds: Type.Integer({ minimum: 0 }),
              percent: Type.Number({ minimum: 0, maximum: 100 }),
            },
            strict,
          ),
        ),
      },
      strict,
    ),
  },
  strict,
);

export const presenceOutputSchema = Type.Union([
  Type.Object(
    {
      ok: Type.Literal(true),
      total: Type.Integer({ minimum: 0 }),
      returned: Type.Integer({ minimum: 0 }),
      people: Type.Array(presenceItemSchema),
      unresolved: Type.Array(unresolvedTargetSchema),
    },
    strict,
  ),
  errorSchema,
]);

export const diagnoseParameters = Type.Object({}, strict);

export const diagnoseOutputSchema = Type.Union([
  Type.Object(
    {
      ok: Type.Literal(true),
      checked_at: Type.String(),
      connection: Type.Object(
        {
          reachable: Type.Literal(true),
          latency_ms: Type.Integer({ minimum: 0 }),
        },
        strict,
      ),
      instance: Type.Object(
        {
          version: Type.Optional(Type.String()),
          state: Type.Optional(Type.String()),
          time_zone: Type.Optional(Type.String()),
          recorder_available: Type.Boolean(),
          history_available: Type.Boolean(),
        },
        strict,
      ),
      entities: Type.Object(
        {
          total: Type.Integer({ minimum: 0 }),
          available: Type.Integer({ minimum: 0 }),
          unavailable: Type.Integer({ minimum: 0 }),
          unknown: Type.Integer({ minimum: 0 }),
          by_domain: Type.Array(
            Type.Object(
              {
                domain: Type.String(),
                count: Type.Integer({ minimum: 0 }),
              },
              strict,
            ),
          ),
        },
        strict,
      ),
      issues: boundedCollection(attentionItemSchema),
    },
    strict,
  ),
  errorSchema,
]);

const targetIdList = Type.Array(Type.String({ minLength: 1, maxLength: 255 }), {
  minItems: 1,
  maxItems: 100,
  uniqueItems: true,
});

export const haTargetSchema = Type.Object(
  {
    entity_id: Type.Optional(
      Type.Array(entityId, {
        minItems: 1,
        maxItems: 100,
        uniqueItems: true,
      }),
    ),
    device_id: Type.Optional(targetIdList),
    area_id: Type.Optional(targetIdList),
    floor_id: Type.Optional(targetIdList),
    label_id: Type.Optional(targetIdList),
  },
  strict,
);

export const executeParameters = Type.Object(
  {
    action: Type.String({
      minLength: 3,
      maxLength: 255,
      pattern: "^[a-z0-9_]+\\.[a-z0-9_]+$",
      description:
        "Home Assistant action in domain.action form, discovered with home_assistant_find.",
    }),
    target: Type.Optional(haTargetSchema),
    data: Type.Optional(
      Type.Record(Type.String({ minLength: 1 }), Type.Unknown(), {
        maxProperties: 100,
      }),
    ),
    return_response: Type.Optional(Type.Boolean()),
    observe: Type.Optional(
      Type.Boolean({
        description:
          "Compare target entity state before and after the action. Defaults to true.",
      }),
    ),
    settle_ms: Type.Optional(
      Type.Integer({
        minimum: 0,
        maximum: 10_000,
        description:
          "Maximum observation settle window after the action. Defaults to plugin configuration or 1500 ms.",
      }),
    ),
    poll_interval_ms: Type.Optional(
      Type.Integer({
        minimum: 100,
        maximum: 2_000,
        description:
          "Delay between observation reads. Defaults to plugin configuration or 250 ms.",
      }),
    ),
  },
  strict,
);

const observationItemSchema = Type.Object(
  {
    entity_id: entityId,
    changed: Type.Boolean(),
    before: Type.Optional(entityProjectionSchema),
    after: Type.Optional(entityProjectionSchema),
  },
  strict,
);

export const executeOutputSchema = Type.Union([
  Type.Object(
    {
      ok: Type.Literal(true),
      action: Type.String(),
      duration_ms: Type.Integer({ minimum: 0 }),
      target: Type.Optional(haTargetSchema),
      context_id: Type.Optional(Type.String()),
      response: Type.Optional(Type.Unknown()),
      response_truncated: Type.Optional(Type.Boolean()),
      observation: Type.Object(
        {
          status: Type.Union([
            Type.Literal("observed"),
            Type.Literal("unavailable"),
            Type.Literal("not_applicable"),
          ]),
          outcome: Type.Optional(
            Type.Union([
              Type.Literal("changed"),
              Type.Literal("no_change_observed"),
            ]),
          ),
          settle_ms: Type.Integer({ minimum: 0 }),
          waited_ms: Type.Integer({ minimum: 0 }),
          attempts: Type.Integer({ minimum: 0 }),
          total: Type.Integer({ minimum: 0 }),
          returned: Type.Integer({ minimum: 0 }),
          truncated: Type.Boolean(),
          changed: Type.Integer({ minimum: 0 }),
          items: Type.Array(observationItemSchema),
        },
        strict,
      ),
      missing_targets: Type.Array(
        Type.Object(
          {
            kind: Type.Union([
              Type.Literal("device"),
              Type.Literal("area"),
              Type.Literal("floor"),
              Type.Literal("label"),
            ]),
            id: Type.String(),
          },
          strict,
        ),
      ),
    },
    strict,
  ),
  errorSchema,
]);
