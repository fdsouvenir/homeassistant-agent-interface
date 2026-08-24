import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDirectory = fileURLToPath(new URL("../", import.meta.url));
const expectedToolNames = [
  "home_assistant_brief",
  "home_assistant_find",
  "home_assistant_execute",
  "home_assistant_inspect",
  "home_assistant_presence",
  "home_assistant_diagnose",
];
const targets = {
  stable: {
    outputSchemaCount: 0,
    packageSpec: "openclaw@2026.7.1-2",
    version: "2026.7.1-2",
  },
  beta: {
    directory: join(rootDirectory, "node_modules/openclaw"),
    outputSchemaCount: expectedToolNames.length,
    version: "2026.8.1-beta.2",
  },
};

const targetName = process.argv[2];
const target = targets[targetName];
if (!target) {
  throw new Error(`usage: node scripts/check-openclaw-compat.mjs stable|beta`);
}

const workspace = await mkdtemp(
  join(tmpdir(), `homeassistant-agent-interface-${targetName}-`),
);

try {
  let hostDirectory = target.directory;
  if (target.packageSpec) {
    const hostPrefix = join(workspace, "host");
    await execFileAsync(
      "npm",
      [
        "install",
        "--prefix",
        hostPrefix,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        target.packageSpec,
      ],
      { cwd: rootDirectory },
    );
    hostDirectory = join(hostPrefix, "node_modules/openclaw");
  }
  assert.equal(typeof hostDirectory, "string");

  const hostPackage = JSON.parse(
    await readFile(join(hostDirectory, "package.json"), "utf8"),
  );
  assert.equal(hostPackage.version, target.version);

  const { stdout } = await execFileAsync(
    "npm",
    ["pack", "--json", "--pack-destination", workspace],
    { cwd: rootDirectory },
  );
  const packResults = JSON.parse(stdout);
  assert.equal(packResults.length, 1);
  const artifact = join(workspace, packResults[0].filename);

  const nodeModules = join(workspace, "node_modules");
  const pluginDirectory = join(nodeModules, "homeassistant-agent-interface");
  await mkdir(pluginDirectory, { recursive: true });
  await execFileAsync("tar", [
    "-xzf",
    artifact,
    "-C",
    pluginDirectory,
    "--strip-components=1",
  ]);
  await symlink(hostDirectory, join(nodeModules, "openclaw"), "dir");
  await symlink(
    join(rootDirectory, "node_modules/typebox"),
    join(nodeModules, "typebox"),
    "dir",
  );

  const entryPath = join(pluginDirectory, "dist/index.js");
  const sdkPath = join(hostDirectory, "dist/plugin-sdk/tool-plugin.js");
  const [{ default: entry }, { getToolPluginMetadata }] = await Promise.all([
    import(`${pathToFileURL(entryPath).href}?target=${targetName}`),
    import(`${pathToFileURL(sdkPath).href}?target=${targetName}`),
  ]);

  const metadata = getToolPluginMetadata(entry);
  assert.equal(metadata?.id, "homeassistant-agent-interface");
  assert.deepEqual(
    metadata?.tools.map((tool) => tool.name),
    expectedToolNames,
  );

  const registeredTools = [];
  entry.register({
    pluginConfig: {
      baseUrl: "http://127.0.0.1:8123",
      token: "compatibility-test-token",
    },
    registerTool(tool) {
      registeredTools.push(tool);
    },
  });
  assert.deepEqual(
    registeredTools.map((tool) => tool.name),
    expectedToolNames,
  );
  assert.equal(
    metadata.tools.filter((tool) => tool.outputSchema !== undefined).length,
    target.outputSchemaCount,
  );
  assert.equal(
    registeredTools.filter((tool) => tool.outputSchema !== undefined).length,
    target.outputSchemaCount,
  );
  assert.equal(
    registeredTools.every((tool) => typeof tool.execute === "function"),
    true,
  );

  await access(
    join(pluginDirectory, "skills/home-assistant-interface/SKILL.md"),
  );
  const pluginPackage = JSON.parse(
    await readFile(join(pluginDirectory, "package.json"), "utf8"),
  );
  assert.equal(pluginPackage.peerDependencies.openclaw, ">=2026.7.1-2");
  assert.equal(pluginPackage.openclaw.install.minHostVersion, ">=2026.7.1-2");
  assert.equal(pluginPackage.openclaw.compat.pluginApi, ">=2026.7.1-2");

  process.stdout.write(
    `${JSON.stringify(
      {
        artifact: packResults[0].filename,
        bundledSkill: "home-assistant-interface",
        host: targetName,
        hostVersion: target.version,
        outputSchemas: target.outputSchemaCount,
        tools: expectedToolNames,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await rm(workspace, { force: true, recursive: true });
}
