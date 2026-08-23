# Operational model

This plugin is a transport and agent-interface layer. It is not an authorization, approval, or household-safety system.

## Authority

Home Assistant decides what the configured user and token may read or execute. The plugin does not maintain entity allowlists, action allowlists, approval rules, or hard-coded risk categories. A successful Home Assistant response is treated as authoritative; a rejection is returned as a structured tool error.

Choose the Home Assistant user and token according to the authority you want the agent to have. OpenClaw tool availability and approval policy, if used, are separate runtime concerns rather than plugin logic.

## Credentials

- The generated manifest declares `token` in `configContracts.secretInputs`.
- Configuration accepts OpenClaw SecretRefs.
- The token is sent only as a REST bearer credential or WebSocket authentication message.
- The plugin has no configuration logging and does not place the token in errors or results.

## Transport behavior

- Only HTTP and HTTPS base URLs are accepted.
- Embedded URL credentials, queries, and fragments are rejected.
- REST and WebSocket paths preserve the configured reverse-proxy base path.
- REST redirects are disabled so authorization is not forwarded to a different origin.
- Requests propagate cancellation, enforce timeouts, and cap inbound bytes.
- REST and WebSocket responses are minimally shape-checked before use.
- Upstream failures use bounded messages and stable error codes.

These properties are reliability and credential-handling invariants. They do not restrict which valid Home Assistant operations the agent may request.

## Data and actions

Discovery and inspection expose data available to the token through compact projections. `home_assistant_inspect.attribute_keys` can retrieve exact requested attributes, including location or integration-specific values, when an agent needs them.

`home_assistant_execute` can request any action accepted by Home Assistant, including physical-device, automation, script, notification, and custom-integration actions. It does not make an independent judgment about those effects. Generic actions are not assumed to be idempotent and should not be blindly replayed after an uncertain interruption.

## Known limitations

- Home Assistant service discovery can describe an action that the current user is not permitted to call; the action call remains authoritative.
- Some registry commands may be unavailable to a non-admin token or an older Home Assistant version. Discovery reports those kinds as unavailable rather than empty.
- A successful action can have delayed or external effects that are not represented by an immediate entity-state change.
- Observation is best-effort. A failed post-action read does not mean the action failed.
- HTTP provides no transport confidentiality. Use HTTPS or an appropriately protected network when that matters to the deployment.
- SecretRefs reduce plaintext configuration persistence but do not create process isolation.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository. Do not open a public issue containing credentials, private entity names, internal URLs, or exploit details.
