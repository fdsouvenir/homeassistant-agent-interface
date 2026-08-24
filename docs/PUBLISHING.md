# Publishing

The package is structured for GitHub and ClawHub distribution. GitHub releases and ClawHub publication are deliberately separate actions.

## Release gate

1. Update `CHANGELOG.md` and choose a SemVer version.
2. Ensure `package.json` and `openclaw.plugin.json` versions agree.
3. Run `npm ci` from a clean checkout.
4. Run `npm run check` and `npm run plugin:validate`.
5. Run `npm run compat`; confirm the packed artifact registers all six tools on 2026.7.1-2 stable and all six output schemas on 2026.8.1 beta 3. On both hosts, confirm `config set --ref-*` preserves the token as a SecretRef and a gateway tool invocation materializes it into the expected Home Assistant bearer credential.
6. Run `npm run clawhub:validate` and review its report.
7. Create the release artifact with `npm pack`; confirm only intended runtime, skill, asset, and documentation files ship.
8. Install that exact tarball through `npm-pack:` in isolated stable and beta OpenClaw profiles. Confirm the plugin runtime and bundled skills are discovered; do not substitute a direct `register()` call for host configuration and runtime activation.
9. Tag the exact commit and create a GitHub release.
10. When ClawHub publication is explicitly approved, publish the exact tested tarball with provenance for the tagged source. Do not publish this repository through the GitHub-source mode: `dist/` is generated and intentionally absent from Git, so that preview does not contain a runnable artifact.
11. Wait for ClawHub security review, then inspect, download, run the readiness check, and install from the public locator on stable and beta before advertising the release.

### ClawHub command

```bash
clawhub package publish ./homeassistant-agent-interface-<version>.tgz \
  --family code-plugin \
  --owner fdsouvenir \
  --source-repo fdsouvenir/homeassistant-agent-interface \
  --source-commit <commit> \
  --source-ref v<version> \
  --tags latest \
  --categories tools \
  --topics home-assistant,home-automation,agent-tools,axi \
  --dry-run
```

Review the preview, then repeat the same command without `--dry-run`.

Never publish from a dirty worktree or from an untagged branch head.
