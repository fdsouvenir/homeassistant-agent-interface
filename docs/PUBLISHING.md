# Publishing

The package is structured for GitHub and ClawHub distribution. GitHub releases and ClawHub publication are deliberately separate actions.

## Release gate

1. Update `CHANGELOG.md` and choose a SemVer version.
2. Ensure `package.json` and `openclaw.plugin.json` versions agree.
3. Run `npm ci` from a clean checkout.
4. Run `npm run check` and `npm run plugin:validate`.
5. Run `npm run clawhub:validate` and review its report.
6. Run `npm pack --dry-run`; confirm only intended runtime and documentation files ship.
7. Inspect the packed tarball or install it through `npm-pack:` in an isolated OpenClaw profile.
8. Tag the exact commit and create a GitHub release.
9. When ClawHub publication is explicitly approved, publish the tagged GitHub source with `clawhub package publish fdsouvenir/homeassistant-agent-interface@<tag> --dry-run`, then without `--dry-run` after reviewing the plan.
10. Wait for ClawHub security review before advertising the install locator.

Never publish from a dirty worktree or from an untagged branch head.
