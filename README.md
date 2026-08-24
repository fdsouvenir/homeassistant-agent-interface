<p align="center">
  <img src="https://raw.githubusercontent.com/fdsouvenir/homeassistant-agent-interface/main/assets/banner.svg" alt="Home Assistant Agent Interface" width="100%" />
</p>

<p align="center">
  <a href="https://github.com/fdsouvenir/homeassistant-agent-interface/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/fdsouvenir/homeassistant-agent-interface/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://github.com/fdsouvenir/homeassistant-agent-interface/blob/main/LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-36d399.svg" /></a>
  <a href="https://docs.openclaw.ai/plugins/tool-plugins"><img alt="OpenClaw 7.1 or newer" src="https://img.shields.io/badge/OpenClaw-7.1%2B-7c3aed.svg" /></a>
  <img alt="Version 0.4.1 stable and beta support" src="https://img.shields.io/badge/v0.4.1-stable%20%2B%20beta-38bdf8.svg" />
</p>

Six compact tools replace raw Home Assistant state dumps and repeated API calls. They let an OpenClaw agent discover the actual installation, understand current state and history, and execute any Home Assistant action available to the configured token.

## What you can ask

- “What lights are on?”
- “Set the kitchen lights to 60%.”
- “Where is everyone?”
- “Find unavailable devices.”

The design follows [Agent eXperience Interface (AXI)](https://github.com/kunchenguid/axi) principles: semantic lookup, progressive detail, batched work, bounded results, explicit partial coverage, definitive empty results, and errors that help the agent correct its next call.

## What it provides

The plugin combines full action execution and live installation discovery with a bundled operating skill that teaches agents how to use the interface efficiently.

- `home_assistant_find` searches entities, actions, areas, devices, floors, and labels from Home Assistant itself.
- `home_assistant_execute` calls any `domain.action` with native Home Assistant target and data objects.
- Entity, device, area, floor, and label targets are supported without a plugin-maintained catalog.
- Action results include compact before/after observations when target entities can be resolved.
- Observation reads settle asynchronously: they stop as soon as a change appears or report that no change was observed within the bounded window.
- Exact dynamic attributes can be requested through `home_assistant_inspect` only when needed.
- The `home-assistant-interface` skill guides tool selection, discovery, execution, and honest interpretation of partial or asynchronous results.
- The plugin has no entity allowlist, action allowlist, approval system, or hard-coded household identities.

Home Assistant remains the source of truth for authorization. The plugin attempts the requested operation and Home Assistant permits or rejects it according to the configured user and token.

## Tools

| Tool                      | Purpose                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `home_assistant_find`     | Search the live catalog across entities, actions, areas, devices, floors, and labels. Supports kind/domain/state filters and pagination.   |
| `home_assistant_execute`  | Execute any Home Assistant action with native targets and data, then return a compact outcome and before/after observation where possible. |
| `home_assistant_inspect`  | Resolve and inspect up to 25 entities in one call. Uses semantic projections and can include exact requested attributes.                   |
| `home_assistant_brief`    | Summarize current state, attention items, presence, and recent changes across explicit or configured entities.                             |
| `home_assistant_presence` | Summarize current zones, transitions, and time-by-zone over a bounded history window.                                                      |
| `home_assistant_diagnose` | Check connectivity and summarize instance and entity health.                                                                               |

The bundled skill is an operating guide rather than another API surface. It loads with the enabled plugin, keeps direct control requests action-oriented, and avoids duplicating the tools' schemas in agent context.

### Typical agent flow

Discover what the installation calls a light and which actions it offers:

```json
{
  "query": "kitchen",
  "kinds": ["entity", "area", "action"],
  "domains": ["light"],
  "limit": 10
}
```

Turn on every compatible light in an area:

```json
{
  "action": "light.turn_on",
  "target": { "area_id": ["kitchen"] },
  "data": { "brightness_pct": 60 }
}
```

The execution result includes Home Assistant's context ID plus bounded state observations for resolved target entities. The first post-action read happens immediately. If no change is visible, the plugin polls until a change appears or the settle deadline expires. For a multi-entity target, polling stops after the first observed target change, so slower targets may still be converging in the returned snapshot. `observation.outcome` distinguishes `changed` from `no_change_observed`, while `attempts` and `waited_ms` make the evidence explicit. A no-change observation does not redefine Home Assistant's successful action response.

Actions that do not target entities—notifications, conversations, some scripts, and similar operations—return `observation.status: "not_applicable"`. If observation reads fail but Home Assistant accepts the action, the successful action is preserved and observation is reported as unavailable. Per-call `settle_ms` and `poll_interval_ms` values override the configured defaults; setting `settle_ms` to `0` restores a single immediate read.

## Requirements

- OpenClaw 2026.7.1-2 or newer.
- A supported Node.js runtime: 22.22.3–22.x, 24.15.0–24.x, or 25.9.0 and newer.
- A reachable Home Assistant instance and a long-lived access token.

### OpenClaw compatibility

| Host                       | Supported interface                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 2026.7.1-2 stable or newer | All six tools, bundled skill, structured JSON results, discovery, control, history, and settled action observations. |
| 2026.8.1 beta 2 or newer   | The same interface, plus host-visible `outputSchema` declarations for result validation and richer tool metadata.    |

The plugin is built with the 2026.8.1 beta 2 SDK and runtime-tested as a packed artifact against both host lines. Stable OpenClaw does not expose the newer output-schema field, but the result objects and plugin behavior are otherwise identical.

## Install

### From ClawHub

Install the latest reviewed release:

```bash
openclaw plugins install clawhub:homeassistant-agent-interface
```

### From GitHub

Install the released tag:

```bash
openclaw plugins install git:github.com/fdsouvenir/homeassistant-agent-interface@v0.4.1
```

For local development:

```bash
git clone https://github.com/fdsouvenir/homeassistant-agent-interface.git
cd homeassistant-agent-interface
npm install
npm run plugin:build
openclaw plugins install -l .
```

## Configure

Create a Home Assistant long-lived access token for the user whose permissions the agent should have. Prefer an OpenClaw SecretRef so the token does not need to be stored directly in `openclaw.json`.

```json5
{
  plugins: {
    entries: {
      "homeassistant-agent-interface": {
        enabled: true,
        config: {
          baseUrl: "http://homeassistant.local:8123",
          token: {
            source: "env",
            provider: "default",
            id: "HOME_ASSISTANT_TOKEN",
          },

          // Optional ambient scopes. These examples are not defaults.
          briefEntities: [
            "sensor.example_temperature",
            "binary_sensor.example_door",
          ],
          presenceEntities: ["person.example"],
        },
      },
    },
  },
}
```

Restart or reload the Gateway after configuration, then inspect the runtime:

```bash
openclaw plugins inspect homeassistant-agent-interface --runtime
```

The plugin contains no default person, device, area, entity, zone, action, or Home Assistant URL. `briefEntities` and `presenceEntities` are optional operator-defined shortcuts used only when those tools receive no explicit targets.

### Configuration reference

| Setting               | Required | Purpose                                                                         |
| --------------------- | -------- | ------------------------------------------------------------------------------- |
| `baseUrl`             | Yes      | Home Assistant origin or reverse-proxy base path; HTTP and HTTPS are supported. |
| `token`               | Yes      | Home Assistant access token or OpenClaw SecretRef.                              |
| `briefEntities`       | No       | Default entity scope for `home_assistant_brief`.                                |
| `presenceEntities`    | No       | Default entity scope for `home_assistant_presence`.                             |
| `requestTimeoutMs`    | No       | REST/WebSocket request timeout, 1–60 seconds; default 10 seconds.               |
| `maxResponseBytes`    | No       | Per-operation inbound response cap, 64 KiB–16 MiB; default 4 MiB.               |
| `maxBriefItems`       | No       | Maximum rows per briefing/diagnostic bucket; default 12.                        |
| `recentChangeMinutes` | No       | “Recent” briefing window; default 60 minutes.                                   |
| `defaultHistoryHours` | No       | Presence window when a call omits one; default 24 hours.                        |
| `maxHistoryHours`     | No       | Maximum allowed presence window; default 168 hours.                             |
| `observationSettleMs` | No       | Default post-action settle deadline, 0–10 seconds; default 1500 ms.             |
| `observationPollMs`   | No       | Default delay between observation reads, 100–2000 ms; default 250 ms.           |

## Agent-facing contract

- Every tool returns the same typed JSON on supported hosts; OpenClaw 2026.8.1 beta 2 and newer also receive the declared `outputSchema`.
- Success is explicit with `ok: true`; expected failures use `ok: false` with a stable code and focused recovery metadata.
- Collections report `total`, `returned`, and `truncated` where bounding matters.
- Discovery reports `coverage.partial`, `available_kinds`, and `unavailable_kinds`; a failed registry cannot masquerade as an authoritative empty result.
- Names are never guessed when the best match is ambiguous.
- `home_assistant_find` batches live service and registry discovery over one authenticated WebSocket session.
- `home_assistant_execute` uses Home Assistant's native `call_service` command rather than a hard-coded domain switch, then performs bounded early-exit observation polling.
- Unknown input fields fail schema validation.

## Authority and transport

This plugin is an interface, not an authorization or household-safety layer. It does not classify actions, request approvals, or restrict entities/actions beyond Home Assistant's own token permissions. If the token can turn on a light, unlock a lock, run a script, or call a custom integration action, the plugin can request it.

Transport behavior is deliberately disciplined because failures and oversized results are bad agent interfaces: requests use the configured origin and base path, redirects are disabled for REST, cancellation and timeouts propagate, inbound data is capped, upstream shapes are checked, and credentials are never logged. See [the operational model](https://github.com/fdsouvenir/homeassistant-agent-interface/blob/main/docs/SECURITY-MODEL.md).

## Development

Requires Node 22.22.3–22.x, 24.15.0–24.x, or 25.9.0+. Authoring uses the OpenClaw 2026.8.1 beta 2 SDK; compatibility tests exercise the packed artifact on both 2026.7.1-2 stable and 2026.8.1 beta 2.

```bash
npm install
npm run plugin:build
npm run plugin:validate
npm test
npm run compat
npm run check
npm pack --dry-run
```

Authoring commands use an isolated temporary OpenClaw state directory. They do not read or migrate the normal Gateway configuration.

See [Architecture](https://github.com/fdsouvenir/homeassistant-agent-interface/blob/main/docs/ARCHITECTURE.md), [Publishing](https://github.com/fdsouvenir/homeassistant-agent-interface/blob/main/docs/PUBLISHING.md), and [Contributing](https://github.com/fdsouvenir/homeassistant-agent-interface/blob/main/CONTRIBUTING.md).

Home Assistant is a trademark of the Open Home Foundation. This community project is not affiliated with or endorsed by the Open Home Foundation or OpenClaw.

## License

[MIT](https://github.com/fdsouvenir/homeassistant-agent-interface/blob/main/LICENSE)
