# Publishing

The package is structured for GitHub and ClawHub distribution. GitHub releases and ClawHub publication are deliberately separate actions.

## Release gate

1. Update `CHANGELOG.md` and choose a SemVer version.
2. Ensure `package.json` and `openclaw.plugin.json` versions agree.
3. Run `npm ci` from a clean checkout.
4. Run `npm run check` and `npm run plugin:validate`.
5. Run `npm run clawhub:validate` and review its report.
6. Create the release artifact with `npm pack`; confirm only intended runtime, skill, asset, and documentation files ship.
7. Install that exact tarball through `npm-pack:` in an isolated OpenClaw profile. Confirm the plugin runtime and bundled skills are discovered.
8. Tag the exact commit and create a GitHub release.
9. When ClawHub publication is explicitly approved, publish the exact tested tarball with provenance for the tagged source:

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

   Review the preview, then repeat the same command without `--dry-run`. Do not publish this repository through the GitHub-source mode: `dist/` is generated and intentionally absent from Git, so that preview does not contain a runnable artifact.

10. Wait for ClawHub security review, then inspect, download, and run the readiness check against the published version before advertising the install locator.

Never publish from a dirty worktree or from an untagged branch head.
