# Architecture

Home Assistant Agent Interface is an OpenClaw tool plugin that translates a live Home Assistant installation into compact agent operations. It is intentionally not a one-tool-per-domain wrapper: discovery comes from Home Assistant, targets use Home Assistant's native model, and one execution tool can call current and future integration actions without plugin releases.

## Request path

1. OpenClaw validates tool input against a strict TypeBox schema.
2. The operation selects the smallest Home Assistant queries needed for the requested job.
3. REST handles state, history, and instance reads; the authenticated WebSocket API handles catalogs, target expansion, and action calls.
4. Parsers validate the upstream shape and convert expected failures into stable agent-facing errors.
5. Projection code returns compact state facts, aggregates, pagination, coverage, and truncation metadata.
6. The plugin returns the documented structured result. OpenClaw 2026.8.1 beta 2 and newer additionally validate it against the declared output schema.

The Home Assistant token is the authority boundary. There is no second entity/action policy inside the plugin.

## Dynamic discovery

`home_assistant_find` searches six resource kinds:

- entities from `/api/states`, enriched when possible by `config/entity_registry/list`;
- actions from `get_services`;
- areas from `config/area_registry/list`;
- devices from `config/device_registry/list`;
- floors from `config/floor_registry/list`;
- labels from `config/label_registry/list`.

Requested WebSocket catalogs are fetched concurrently over one authenticated connection. Results are normalized into one small match shape and ranked across ID, name, alias, and description. Kind, domain, and state filters reduce both agent context and ambiguity.

Registry availability can vary with Home Assistant version and user permissions. The tool therefore returns explicit coverage. A successful source can produce a definitive empty result; a failed source is listed under `unavailable_kinds` and never silently treated as empty.

## General action execution

`home_assistant_execute` accepts a live `domain.action` identifier, arbitrary JSON action data, and Home Assistant's target fields:

- `entity_id`
- `device_id`
- `area_id`
- `floor_id`
- `label_id`

The operation sends these values through the WebSocket `call_service` command without domain-specific branching or plugin-maintained action lists. Home Assistant performs validation and authorization.

Observation is on by default. Explicit entity targets are observed directly; semantic targets are expanded with `extract_from_target`. After the blocking action call, the plugin reads immediately and then polls only while no state change is visible. It exits early on change or at a bounded settle deadline. The result preserves the existing observation status while adding a `changed` or `no_change_observed` outcome, read-attempt count, and actual wait time.

The default settle window is 1500 ms with 250 ms polling. Operators can configure both values, and each action call can override them. A zero settle window performs one immediate read. Observation failure or a no-change outcome does not rewrite a successful Home Assistant action as a failure. Calls without resolvable entity targets report `not_applicable`, and callers can disable observation when the extra state reads are not useful.

Action response data is requested only when `return_response` is true. Discovery reports whether an action response is absent, optional, or required when Home Assistant supplies that metadata.

## Read operations

### Inspect

`home_assistant_inspect` resolves up to 25 names or canonical entity IDs and emits domain-aware facts. Exact Home Assistant attributes can be requested with `attribute_keys`; the plugin does not dump every attribute by default.

### Brief

`home_assistant_brief` combines selected entity state, attention items, presence, and recent changes. It requires explicit targets or operator-configured `briefEntities`; no household member or device is built in.

### Presence

`home_assistant_presence` combines current state with bounded, minimal significant-change history. It deduplicates adjacent zones and computes transitions and time-by-zone. Exact additional tracker attributes remain available through `home_assistant_inspect` when requested.

### Diagnose

`home_assistant_diagnose` combines a small instance projection with aggregate entity health and attention items. It is an interface diagnostic, not a Home Assistant configuration or log browser.

## OpenClaw compatibility contracts

- `defineToolPlugin` is the runtime entry contract.
- `contracts.tools` is generated from static tool metadata.
- every tool declares a closed `outputSchema`; 2026.7.1-2 stable ignores this newer field while preserving the same structured result;
- `activation.onStartup` is `false` for lazy, tool-owned activation;
- `home_assistant_execute` is explicitly not replay-safe because arbitrary Home Assistant actions may be non-idempotent;
- configuration signals identify `baseUrl` and `token`;
- `configContracts.secretInputs` declares `token` for SecretRef materialization;
- `openclaw.compat.pluginApi` and the installation floor target OpenClaw 2026.7.1-2;
- build provenance targets the 2026.8.1 beta 2 SDK, and the packed artifact is tested against both versions.

## AXI interpretation

AXI shapes the interaction rather than mimicking CLI output. Native OpenClaw tools return typed JSON that Code Mode and Tool Search can understand. The implementation favors:

- semantic search over endpoint memorization;
- live capability discovery over hard-coded catalogs;
- one general mutation primitive over per-domain tool sprawl;
- compact defaults and exact attribute escalation;
- batched network work and precomputed aggregates;
- explicit coverage, truncation, ambiguity, and empty results;
- error details that let an agent correct the next call.
