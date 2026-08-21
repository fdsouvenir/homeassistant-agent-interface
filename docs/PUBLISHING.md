# Publishing

The package is structured for GitHub and ClawHub distribution. Publishing is deliberately separate from merging code.

## Release gate

1. Update `CHANGELOG.md` and choose a SemVer version.
2. Ensure `package.json` and `openclaw.plugin.json` versions agree.
3. Run `npm ci` from a clean checkout.
4. Run `npm run check` and `npm run plugin:validate`.
5. Run `npm run clawhub:validate` and review its report.
6. Run `npm pack --dry-run`; confirm only intended runtime and documentation files ship.
7. Inspect the packed tarball or install it through `npm-pack:` in an isolated OpenClaw profile.
8. Tag the exact commit and create a GitHub release.
9. Publish the tagged GitHub source to ClawHub with `clawhub package publish fdsouvenir/homeassistant-agent-interface@<tag> --dry-run`, then without `--dry-run` after reviewing the plan.
10. Wait for ClawHub security review before advertising the install locator.

Never publish from a dirty worktree or from an untagged branch head.
