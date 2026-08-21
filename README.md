<p align="center">
  <img src="assets/banner.svg" alt="Home Assistant Agent Interface" width="100%" />
</p>

<p align="center">
  <a href="https://github.com/fdsouvenir/homeassistant-agent-interface/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/fdsouvenir/homeassistant-agent-interface/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-36d399.svg" /></a>
  <a href="https://docs.openclaw.ai/plugins/tool-plugins"><img alt="OpenClaw 8.1 tool plugin" src="https://img.shields.io/badge/OpenClaw-8.1-7c3aed.svg" /></a>
  <img alt="Read only" src="https://img.shields.io/badge/v0.1-read--only-38bdf8.svg" />
</p>

A secure, token-efficient Home Assistant interface for OpenClaw agents. It exposes household meaning—not Home Assistant's raw REST surface—through typed, bounded tools designed around [Agent eXperience Interface (AXI)](https://github.com/kunchenguid/axi) principles.

> [!IMPORTANT]
> Version 0.1 is intentionally read-only. It cannot call services, run automations, modify state, render templates, or retrieve raw logs.

## Why this exists

Typical Home Assistant tools mirror API endpoints: dump every state, expose arbitrary service calls, and make the model assemble meaning across repeated requests. That creates large prompts and a broad security boundary.

This plugin takes a narrower approach:

- semantic operations instead of endpoint wrappers;
- compact defaults with explicit detail levels;
- batched inspection and precomputed aggregates;
- definitive empty results and stable structured errors;
- hard response, history, item, and time limits;
- SecretRef-aware token configuration;
- no raw configuration, logs, coordinates, or attribute dumps;
- no hard-coded people, devices, entities, zones, or homes.

## Tools

| Tool                      | What it answers                                                              | Default behavior                                                                 |
| ------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `home_assistant_brief`    | What matters across a chosen household scope right now?                      | States, attention items, presence, and recent changes in one bounded response    |
| `home_assistant_find`     | Which entity does this name or partial reference mean?                       | Ranked canonical IDs with pagination and a definitive empty result               |
| `home_assistant_inspect`  | What is the useful state of these targets?                                   | Up to 25 type-aware projections; `summary`, `detail`, or safe `full`             |
| `home_assistant_presence` | Where are configured or explicit presence targets, and how did zones change? | Optional tool; current zone plus transitions and time-by-zone, never coordinates |
| `home_assistant_diagnose` | Is the integration healthy?                                                  | Optional tool; connectivity and scoped entity health without raw logs            |

`full` means the fullest **safe semantic projection** known by the plugin. It never means “return every Home Assistant attribute.”

## Install

### From GitHub while the ClawHub release is pending

Review the repository, then install the development branch (or replace `main` with a commit you trust):

```bash
openclaw plugins install git:github.com/fdsouvenir/homeassistant-agent-interface@main
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

Once the first release clears ClawHub review:

```bash
openclaw plugins install clawhub:homeassistant-agent-interface
```

## Configure

Create a dedicated Home Assistant user with only the access you are comfortable granting. Generate a long-lived access token from that user's Home Assistant profile.

Prefer an OpenClaw SecretRef so the token is not stored as plaintext in `openclaw.json`:

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

          // Optional ambient scopes. These are examples, never defaults.
          briefEntities: [
            "sensor.example_temperature",
            "binary_sensor.example_door",
          ],
          presenceEntities: ["person.example"],

          // Optional exposure boundary. If both are omitted, all entities are readable.
          allowedEntities: ["person.example"],
          allowedDomains: ["sensor", "binary_sensor", "light"],
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

`home_assistant_brief` and `home_assistant_presence` accept explicit targets. Their configured entity lists are only used when a call omits targets; the plugin contains no identity-specific fallback.

### Configuration reference

| Setting               | Required | Purpose                                                                         |
| --------------------- | -------- | ------------------------------------------------------------------------------- |
| `baseUrl`             | Yes      | Home Assistant origin or reverse-proxy base path; HTTP and HTTPS are supported  |
| `token`               | Yes      | Access token; a SecretRef is strongly recommended                               |
| `briefEntities`       | No       | Default scope for `home_assistant_brief`                                        |
| `presenceEntities`    | No       | Default scope for `home_assistant_presence`                                     |
| `allowedEntities`     | No       | Exact entity IDs the plugin may reveal                                          |
| `allowedDomains`      | No       | Entity domains the plugin may reveal; combined with entities using OR semantics |
| `requestTimeoutMs`    | No       | Request timeout, 1–60 seconds; default 10 seconds                               |
| `maxResponseBytes`    | No       | Per-response byte cap, 64 KiB–16 MiB; default 4 MiB                             |
| `maxBriefItems`       | No       | Maximum rows per briefing/diagnostic bucket; default 12                         |
| `recentChangeMinutes` | No       | “Recent” briefing window; default 60 minutes                                    |
| `defaultHistoryHours` | No       | Presence window when the call omits one; default 24 hours                       |
| `maxHistoryHours`     | No       | Maximum allowed presence window; default 168 hours                              |

## Output contract

Every operation returns typed JSON in `details` and declares an OpenClaw `outputSchema`.

- Success is explicit with `ok: true`.
- Expected failures return `ok: false` with a stable code, retryability, and focused recovery metadata.
- Collections include `total`, `returned`, and `truncated` where bounding matters.
- Empty matches are successful and definitive: `total: 0`, `matches: []`.
- Ambiguous names return bounded candidate entity IDs instead of guessing.
- Unknown input fields fail schema validation.

Example presence projection:

```json
{
  "ok": true,
  "total": 1,
  "returned": 1,
  "people": [
    {
      "entity_id": "person.example",
      "name": "Example person",
      "current": {
        "zone": "home",
        "since": "2026-08-21T16:00:00.000Z"
      },
      "window": {
        "start": "2026-08-21T08:00:00.000Z",
        "end": "2026-08-21T20:00:00.000Z",
        "observed": true,
        "transitions": {
          "total": 2,
          "returned": 2,
          "truncated": false,
          "items": [
            {
              "at": "2026-08-21T10:00:00.000Z",
              "from": "home",
              "to": "work"
            },
            {
              "at": "2026-08-21T16:00:00.000Z",
              "from": "work",
              "to": "home"
            }
          ]
        },
        "time_by_zone": [
          { "zone": "work", "seconds": 21600, "percent": 50 },
          { "zone": "home", "seconds": 21600, "percent": 50 }
        ]
      }
    }
  ],
  "unresolved": []
}
```

## Security model

The access token is powerful even though this plugin is read-only. Read [the security model](docs/SECURITY-MODEL.md) before production use.

Key controls include configured-origin binding, redirects disabled, GET-only transport, abort propagation, timeouts, response byte caps, allowlist filtering, sanitized upstream failures, and deliberate omission of sensitive attributes. The manifest declares `token` as a SecretRef input and all tools as replay-safe. Presence history and diagnostics are optional tools that must be explicitly allowed by tool policy.

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

Authoring commands run with an isolated temporary OpenClaw state directory. They do not read or migrate your normal Gateway configuration.

See [Architecture](docs/ARCHITECTURE.md), [Publishing](docs/PUBLISHING.md), and [Contributing](CONTRIBUTING.md).

## Status and roadmap

This is an early read-only release. Potential control tools will be considered separately and must use outcome-oriented, idempotent operations with explicit approval—not a generic `call_service` escape hatch.

Home Assistant is a trademark of the Open Home Foundation. This community project is not affiliated with or endorsed by the Open Home Foundation or OpenClaw.

## License

[MIT](LICENSE)
