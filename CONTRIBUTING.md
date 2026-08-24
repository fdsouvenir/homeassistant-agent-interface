# Contributing

Thanks for helping make Home Assistant easier and more efficient for agents to use.

## Ground rules

- Keep the public tool surface semantic and compact; do not mirror raw endpoint responses.
- Do not add people, device, entity, zone, host, or token defaults.
- Discover entities, actions, areas, devices, floors, labels, and capabilities from Home Assistant instead of hard-coding integration catalogs.
- Keep authorization in Home Assistant. Do not add plugin-maintained action/entity allowlists or approval categories.
- Expose integration-specific data through explicit progressive disclosure rather than default attribute dumps.
- Preserve bounded collections, strict schemas, stable errors, and definitive empty results.
- Keep action execution general and report compact observations without assuming every action is idempotent.
- Use neutral fixture identities such as `person.example`.

## Development

```bash
npm install
npm run plugin:build
npm run plugin:validate
npm test
npm run compat
npm run check
```

Please add tests for behavior and output-schema compatibility. `npm run compat` builds and packs once per target, installs the artifact into isolated stable and beta OpenClaw profiles, configures a canonical SecretRef, and invokes a tool through each real gateway. Pull requests should explain the agent workflow improved and its token/round-trip impact.
