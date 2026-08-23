export type JsonPrimitive = string | number | boolean | null;

export type PluginConfig = {
  baseUrl: string;
  token: string;
  briefEntities?: string[];
  presenceEntities?: string[];
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  maxBriefItems?: number;
  recentChangeMinutes?: number;
  defaultHistoryHours?: number;
  maxHistoryHours?: number;
  observationSettleMs?: number;
  observationPollMs?: number;
};

export type HaAttributes = Record<string, unknown>;

export type HaState = {
  entity_id: string;
  state: string;
  attributes: HaAttributes;
  last_changed: string;
  last_updated?: string;
};

export type HaHistoryState = {
  entity_id?: string;
  state: string;
  attributes?: HaAttributes;
  last_changed: string;
  last_updated?: string;
};

export type HaConfig = {
  version?: string;
  state?: string;
  time_zone?: string;
  components?: string[];
};

export type Recovery = {
  action: "choose_target" | "configure_plugin" | "narrow_request" | "retry";
  tool?: string;
  fields?: string[];
  candidate_entity_ids?: string[];
};

export type ErrorCode =
  | "ACCESS_DENIED"
  | "AMBIGUOUS_TARGET"
  | "AUTH_FAILED"
  | "CONFIG_REQUIRED"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "REQUEST_ABORTED"
  | "RESPONSE_TOO_LARGE"
  | "UPSTREAM_INVALID_RESPONSE"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_UNAVAILABLE";

export type ErrorResult = {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    recovery?: Recovery;
  };
};

export type Fact = {
  key: string;
  value: JsonPrimitive;
  unit?: string;
};

export type EntityProjection = {
  entity_id: string;
  name: string;
  domain: string;
  state: string;
  available: boolean;
  changed_at: string;
  changed_seconds_ago: number;
  updated_at?: string;
  facts?: Fact[];
  attributes?: Record<string, unknown>;
  attributes_truncated?: boolean;
};

export type UnresolvedTarget = {
  target: string;
  reason: "ambiguous" | "not_found" | "unavailable" | "unsupported";
  candidate_entity_ids?: string[];
};

export type DiscoveryKind =
  "entity" | "action" | "area" | "device" | "floor" | "label";

export type HaTarget = {
  entity_id?: string[];
  device_id?: string[];
  area_id?: string[];
  floor_id?: string[];
  label_id?: string[];
};

export type WebSocketCommand = {
  type: string;
  [key: string]: unknown;
};

export type SettledCommand =
  { ok: true; value: unknown } | { ok: false; error: InterfaceErrorShape };

export type InterfaceErrorShape = {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  recovery?: Recovery;
};
