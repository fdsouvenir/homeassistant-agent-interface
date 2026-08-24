# Changelog

All notable changes will be documented here. This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Fresh installation on OpenClaw stable no longer fails validation before Home Assistant configuration can be supplied. The plugin remains inactive until `baseUrl` and `token` are configured, and tool execution still returns `CONFIG_REQUIRED` when either value is absent.

## [0.4.0] - 2026-08-23

### Added

- Official support for the current OpenClaw stable channel starting at 2026.7.1-2.
- Packed-artifact compatibility checks for stable and 2026.8.1 beta 2, including six-tool registration, bundled-skill presence, and version-specific output-schema behavior.
- A GitHub Actions compatibility matrix that exercises both supported host lines independently.

### Changed

- Installation, peer dependency, and plugin API metadata now admit stable OpenClaw hosts.
- Documentation distinguishes the complete stable tool interface from the additional host-visible output schemas available on 2026.8.1 beta 2 and newer.

## [0.3.1] - 2026-08-23

### Changed

- Public copy now leads with the six-tool, token-efficiency differentiator and concrete requests that users can hand to their agent.
- ClawHub publication metadata now places the plugin in the `Tools` category instead of `Other`.
- GitHub installation documentation now points to the `v0.3.1` release tag.

## [0.3.0] - 2026-08-23

### Added

- A bundled `home-assistant-interface` skill that teaches agents efficient discovery, direct action execution, progressive inspection, and precise result interpretation.
- Package tests that ensure the operating skill is declared and included in the published artifact.

### Changed

- Public documentation now leads with the reviewed ClawHub install path, states exact OpenClaw and Node.js requirements, and documents first-change observation behavior for multi-entity targets.
- ClawHub publishing now uses the exact tested npm tarball with tagged-source provenance.
- Node.js engine metadata now matches the runtimes supported by OpenClaw 8.1.

## [0.2.1] - 2026-08-23

### Added

- Bounded post-action observation polling with configurable settle and poll intervals.
- Early exit when target state changes, plus explicit `changed` and `no_change_observed` outcomes.
- Observation attempt counts and actual wait durations for evidence-aware agent feedback.
- Cancellation coverage for active settle windows, bringing the suite to 35 tests.

### Fixed

- Asynchronous physical-device updates no longer appear as immediate no-change observations when they arrive within the settle window.

## [0.2.0] - 2026-08-23

### Added

- Live discovery of Home Assistant actions, areas, devices, floors, labels, and enriched entities through one bounded search tool.
- General `home_assistant_execute` action calls with native entity, device, area, floor, and label targets.
- Compact before/after entity observation, missing-target reporting, Home Assistant context IDs, and optional action response data.
- Exact attribute selection for `home_assistant_inspect`.
- WebSocket authentication, batching, timeouts, abort propagation, response caps, and stable command errors.

### Changed

- Home Assistant token permissions are now the sole read/action authority; plugin-maintained entity and domain allowlists were removed.
- All six tools are available as the plugin's core interface rather than hiding presence and diagnostics as optional tools.
- Discovery reports partial source coverage explicitly and no longer treats an unavailable registry as an empty result.
- Invalid state and history timestamps now produce an upstream-data error instead of appearing freshly changed.
- Test coverage expanded from 10 to 32 tests, including adversarial transport, ambiguity, partial failure, dynamic discovery, and mutation cases.

## [0.1.0] - 2026-08-21

### Added

- Typed OpenClaw 8.1 tool-plugin contract.
- Read-only brief, find, inspect, presence, and diagnostic operations.
- AXI-inspired bounded projections, aggregates, structured errors, and definitive empty results.
- SecretRef declaration, configured-origin binding, redirect blocking, timeouts, byte caps, and optional exposure scopes.
- Neutral tests, public documentation, CI, and ClawHub package metadata.

[Unreleased]: https://github.com/fdsouvenir/homeassistant-agent-interface/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/fdsouvenir/homeassistant-agent-interface/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/fdsouvenir/homeassistant-agent-interface/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/fdsouvenir/homeassistant-agent-interface/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/fdsouvenir/homeassistant-agent-interface/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/fdsouvenir/homeassistant-agent-interface/compare/6ab0c49...v0.2.0
[0.1.0]: https://github.com/fdsouvenir/homeassistant-agent-interface/commit/6ab0c49
