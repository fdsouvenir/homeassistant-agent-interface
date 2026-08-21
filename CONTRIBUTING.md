# Contributing

Thanks for helping make Home Assistant safer and easier for agents to use.

## Ground rules

- Keep the public tool surface semantic; do not mirror raw REST endpoints.
- Do not add people, device, entity, zone, host, or token defaults.
- Never return raw state attributes, configuration, logs, or response bodies.
- Preserve bounded collections, strict schemas, stable errors, and definitive empty results.
- Mutating tools require a separate design and security review.
- Use neutral fixture identities such as `person.example`.

## Development

```bash
npm install
npm run plugin:build
npm run plugin:validate
npm test
npm run check
```

Please add tests for behavior and output-schema compatibility. Pull requests should explain the agent workflow improved, its token/round-trip impact, and any change to the security boundary.
