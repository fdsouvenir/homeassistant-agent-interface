import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const stateDirectory = mkdtempSync(
  join(tmpdir(), "homeassistant-agent-interface-openclaw-"),
);
const executable = fileURLToPath(
  new URL("../node_modules/openclaw/openclaw.mjs", import.meta.url),
);

try {
  const result = spawnSync(
    process.execPath,
    [executable, ...process.argv.slice(2)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OPENCLAW_CONFIG_PATH: join(stateDirectory, "openclaw.json"),
        OPENCLAW_STATE_DIR: stateDirectory,
      },
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(stateDirectory, { force: true, recursive: true });
}
