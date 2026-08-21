# Architecture

Home Assistant Agent Interface is a clean-room OpenClaw tool plugin. It translates Home Assistant state into bounded semantic projections rather than exposing REST endpoints as tools.

## Boundaries

1. OpenClaw validates tool input against strict TypeBox schemas.
2. An operation resolves explicit or configured targets within the optional entity/domain exposure scope.
3. The client performs authenticated GET requests against the configured Home Assistant origin.
4. Parsers validate the minimum upstream shape.
5. Projection code selects useful, non-sensitive fields and computes aggregates.
6. OpenClaw validates returned `details` against the declared output schema.

Raw upstream objects never become tool results.

## Tool semantics

### Brief

`home_assistant_brief` is the bounded ambient-context operation. It requires explicit targets or `briefEntities`; it does not silently select a person, device, room, or domain. Attention and recent-change buckets are computed in the plugin to avoid agent-side N+1 reads.

### Find

`home_assistant_find` loads the state index internally, filters it through the exposure scope, ranks names and IDs, and returns compact matches. Pagination is offset-based and intentionally simple because Home Assistant state collections are live snapshots rather than durable search indexes.

### Inspect

`home_assistant_inspect` resolves up to 25 targets and emits domain-aware facts. All detail levels use an allowlisted projection; `full` adds known safe facts but never raw attributes.

### Presence

`home_assistant_presence` combines current state with Home Assistant's bounded history endpoint. It requests minimal significant-change records, deduplicates adjacent zones, computes time-by-zone, and returns only the latest bounded transition set. Latitude, longitude, GPS accuracy, and raw tracker attributes are never projected.

Because historical presence is sensitive, the tool is optional in OpenClaw's catalog and requires explicit tool-policy allowlisting.

### Diagnose

`home_assistant_diagnose` is optional. It combines a safe subset of `/api/config` with scoped state health. It does not call `/api/error_log`, return Home Assistant's location, enumerate components, or echo URLs and credentials.

## OpenClaw 8.1 contracts

- `defineToolPlugin` is the runtime entry contract.
- `contracts.tools` is generated from static tool metadata.
- every tool has an `outputSchema` with closed object layers;
- `activation.onStartup` is `false` for lazy, tool-owned activation;
- tool metadata includes configuration signals and replay safety;
- `configContracts.secretInputs` declares `token` for startup materialization;
- `openclaw.compat.pluginApi` and build provenance target 2026.8.1-beta.2.

## AXI interpretation

AXI informs the agent contract, not the transport encoding. Native OpenClaw tools return typed JSON rather than CLI tables or TOON. The adopted principles are compact defaults, contextual disclosure, batching, precomputed aggregates, explicit truncation, definitive empty states, and self-correcting structured errors.
