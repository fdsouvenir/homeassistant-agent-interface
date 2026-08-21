# Security model

## Trust assumptions

- The OpenClaw Gateway host and plugin installation directory are trusted.
- The configured Home Assistant endpoint is controlled by the operator.
- The Home Assistant token may read every resource permitted to its user, regardless of this plugin's projections.
- Tool output can become model-visible and should be treated as disclosed to the selected model provider.

Use a dedicated Home Assistant user and the least-privileged deployment arrangement available to you. Home Assistant long-lived tokens are not endpoint-scoped capabilities.

## Implemented controls

### Credentials

- The manifest declares `token` in `configContracts.secretInputs`.
- Documentation recommends an OpenClaw SecretRef.
- The token is only used in the Authorization header.
- Errors never include request or response bodies, configured URLs, or tokens.
- There are no config logging calls.

### Network

- Only HTTP and HTTPS base URLs are accepted.
- Embedded URL credentials, queries, and fragments are rejected.
- Every path is resolved beneath the configured base path and checked against the configured origin.
- Redirects are disabled, preventing bearer-token forwarding to another origin.
- Requests use GET only, omit browser credentials, omit referrers, propagate cancellation, and enforce a timeout.
- Declared and streamed response sizes are capped.

### Data minimization

- No operation returns raw Home Assistant state objects.
- Precise location fields are omitted at every detail level.
- Configuration output excludes latitude, longitude, elevation, location name, directories, URLs, and component lists.
- Raw logs are never requested.
- Optional entity/domain scope rules filter discovery and output.
- Collections and history windows are bounded.

### Mutations

Version 0.1 has no mutation transport and no service-call operation. A future control surface must be reviewed as a separate threat model and use explicit outcomes, idempotency, state verification, and OpenClaw approval hooks.

## Known limitations

- With no `allowedEntities` or `allowedDomains`, all entity IDs and states available to the Home Assistant token can be searched or explicitly inspected.
- Home Assistant's REST API may expose sensitive entity names and state strings. Configure scope rules accordingly.
- SecretRefs reduce plaintext persistence but are not process isolation; see the OpenClaw secrets documentation.
- HTTP is supported for local networks but does not provide transport confidentiality. Prefer HTTPS or a protected network path.
- The plugin cannot reduce the Home Assistant token's server-side privileges.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting for this repository. Do not open a public issue containing credentials, private entity names, internal URLs, or exploit details.
