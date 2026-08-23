<p align="center">
  <img src="assets/banner.svg" alt="Home Assistant Agent Interface" width="100%" />
</p>

<p align="center">
  <a href="https://github.com/fdsouvenir/homeassistant-agent-interface/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/fdsouvenir/homeassistant-agent-interface/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-36d399.svg" /></a>
  <a href="https://docs.openclaw.ai/plugins/tool-plugins"><img alt="OpenClaw 8.1 tool plugin" src="https://img.shields.io/badge/OpenClaw-8.1-7c3aed.svg" /></a>
  <img alt="Version 0.2 read and control" src="https://img.shields.io/badge/v0.2-read%20%2B%20control-38bdf8.svg" />
</p>

A token-efficient Home Assistant interface for OpenClaw agents. It gives an agent compact, typed tools to discover the actual installation, understand current state and history, and execute any Home Assistant action available to the configured token.

The design follows [Agent eXperience Interface (AXI)](https://github.com/kunchenguid/axi) principles: semantic lookup, progressive detail, batched work, bounded results, explicit partial coverage, definitive empty results, and errors that help the agent correct its next call.

## What v0.2 changes

Version 0.2 adds full action execution and live installation discovery.

- `home_assistant_find` searches entities, actions, areas, devices, floors, and labels from Home Assistant itself.
- `home_assistant_execute` calls any `domain.action` with native Home Assistant target and data objects.
- Entity, device, area, floor, and label targets are supported without a plugin-maintained catalog.
- Action results include compact before/after observations when target entities can be resolved.
- Exact dynamic attributes can be requested through `home_assistant_inspect` only when needed.
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

The execution result includes Home Assistant's context ID plus bounded state observations for resolved target entities. Actions that do not target entities—notifications, conversations, some scripts, and similar operations—return `observation.status: "not_applicable"`. If observation reads fail but Home Assistant accepts the action, the successful action is preserved and observation is reported as unavailable.

## Install

### From GitHub

Install the released tag:

```bash
openclaw plugins install git:github.com/fdsouvenir/homeassistant-agent-interface@v0.2.0
```

For local development:

```bash
git clone https://github.com/fdsouvenir/homeassistant-agent-interface.git
cd homeassistant-agent-interface
npm install
npm run plugin:build
openclaw plugins install -l .
```

### From ClawHub

ClawHub publishing is a separate release step. Once a reviewed package is available:

```bash
openclaw plugins install clawhub:homeassistant-agent-interface
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

## Agent-facing contract

- Every tool returns typed JSON and declares an OpenClaw `outputSchema`.
- Success is explicit with `ok: true`; expected failures use `ok: false` with a stable code and focused recovery metadata.
- Collections report `total`, `returned`, and `truncated` where bounding matters.
- Discovery reports `coverage.partial`, `available_kinds`, and `unavailable_kinds`; a failed registry cannot masquerade as an authoritative empty result.
- Names are never guessed when the best match is ambiguous.
- `home_assistant_find` batches live service and registry discovery over one authenticated WebSocket session.
- `home_assistant_execute` uses Home Assistant's native `call_service` command rather than a hard-coded domain switch.
- Unknown input fields fail schema validation.

## Authority and transport

This plugin is an interface, not an authorization or household-safety layer. It does not classify actions, request approvals, or restrict entities/actions beyond Home Assistant's own token permissions. If the token can turn on a light, unlock a lock, run a script, or call a custom integration action, the plugin can request it.

Transport behavior is deliberately disciplined because failures and oversized results are bad agent interfaces: requests use the configured origin and base path, redirects are disabled for REST, cancellation and timeouts propagate, inbound data is capped, upstream shapes are checked, and credentials are never logged. See [the operational model](docs/SECURITY-MODEL.md).

## Development

Requires Node 22.22.3+ and the OpenClaw 8.1 plugin API.

```bash
npm install
npm run plugin:build
npm run plugin:validate
npm test
npm run check
npm pack --dry-run
```

Authoring commands use an isolated temporary OpenClaw state directory. They do not read or migrate the normal Gateway configuration.

See [Architecture](docs/ARCHITECTURE.md), [Publishing](docs/PUBLISHING.md), and [Contributing](CONTRIBUTING.md).

Home Assistant is a trademark of the Open Home Foundation. This community project is not affiliated with or endorsed by the Open Home Foundation or OpenClaw.

## License

[MIT](LICENSE)
