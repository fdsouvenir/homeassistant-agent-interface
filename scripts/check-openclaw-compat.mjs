import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDirectory = fileURLToPath(new URL("../", import.meta.url));
const pluginId = "homeassistant-agent-interface";
const compatibilityToken = "compatibility-test-token";
const compatibilityTokenEnv = "HA_INTERFACE_COMPAT_TOKEN";
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
    version: "2026.8.1-beta.3",
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
let homeAssistantServer;
let gatewayProcess;
const homeAssistantSockets = new Set();

function progress(message) {
  process.stderr.write(`[compat:${targetName}] ${message}\n`);
}

function parseJsonOutput(stdout, label) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON: ${stdout}`, {
      cause: error,
    });
  }
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return address.port;
}

async function reservePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), delay(5_000)]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
}

try {
  progress(`preparing OpenClaw ${target.version}`);
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

  const stateDirectory = join(workspace, "state");
  const configPath = join(stateDirectory, "openclaw.json");
  const cliPath = join(hostDirectory, "openclaw.mjs");
  const cliEnvironment = {
    ...process.env,
    [compatibilityTokenEnv]: compatibilityToken,
    OPENCLAW_CONFIG_PATH: configPath,
    OPENCLAW_STATE_DIR: stateDirectory,
    NO_COLOR: "1",
  };
  const runCli = async (args, timeout = 120_000) =>
    execFileAsync(process.execPath, [cliPath, ...args], {
      cwd: rootDirectory,
      env: cliEnvironment,
      maxBuffer: 10 * 1024 * 1024,
      timeout,
    });

  const authorizationHeaders = [];
  homeAssistantServer = createServer((request, response) => {
    authorizationHeaders.push(request.headers.authorization);
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/config") {
      response.end(
        JSON.stringify({
          components: ["history", "recorder"],
          state: "RUNNING",
          time_zone: "UTC",
          version: "compatibility-test",
        }),
      );
      return;
    }
    if (request.url === "/api/states") {
      response.end("[]");
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ message: "not found" }));
  });
  homeAssistantServer.on("connection", (socket) => {
    homeAssistantSockets.add(socket);
    socket.on("close", () => homeAssistantSockets.delete(socket));
  });
  const homeAssistantPort = await listen(homeAssistantServer);

  progress("installing the packed plugin into an isolated profile");
  await runCli(["plugins", "install", `npm-pack:${artifact}`, "--force"]);
  const configRoot = `plugins.entries.${pluginId}.config`;
  await runCli([
    "config",
    "set",
    `${configRoot}.baseUrl`,
    `http://127.0.0.1:${homeAssistantPort}`,
  ]);
  await runCli([
    "config",
    "set",
    `${configRoot}.token`,
    "--ref-source",
    "env",
    "--ref-provider",
    "default",
    "--ref-id",
    compatibilityTokenEnv,
  ]);
  await runCli(["plugins", "enable", pluginId]);
  await runCli(["config", "set", "gateway.mode", "local"]);

  const sourceConfig = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(sourceConfig.plugins.entries[pluginId].config.token, {
    source: "env",
    provider: "default",
    id: compatibilityTokenEnv,
  });

  const runtimeInspection = parseJsonOutput(
    (await runCli(["plugins", "inspect", pluginId, "--runtime", "--json"]))
      .stdout,
    "plugins inspect",
  );
  assert.equal(runtimeInspection.plugin?.status, "loaded");
  assert.equal(runtimeInspection.plugin?.version, pluginPackage.version);
  assert.deepEqual(runtimeInspection.plugin?.toolNames, expectedToolNames);

  const skills = parseJsonOutput(
    (await runCli(["skills", "list", "--json"])).stdout,
    "skills list",
  );
  const bundledSkill = skills.skills?.find(
    (skill) => skill.name === "home-assistant-interface",
  );
  assert.equal(bundledSkill?.eligible, true);
  assert.equal(bundledSkill?.modelVisible, true);

  progress("starting an isolated gateway");
  const gatewayPort = await reservePort();
  await runCli(["config", "set", "gateway.port", String(gatewayPort)]);
  await runCli(["config", "set", "gateway.auth.mode", "token"]);
  await runCli([
    "config",
    "set",
    "gateway.auth.token",
    "compatibility-gateway-token",
  ]);
  const gatewayOutput = [];
  gatewayProcess = spawn(
    process.execPath,
    [
      cliPath,
      "gateway",
      "run",
      "--bind",
      "loopback",
      "--port",
      String(gatewayPort),
    ],
    {
      cwd: rootDirectory,
      env: cliEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [gatewayProcess.stdout, gatewayProcess.stderr]) {
    stream.on("data", (chunk) => {
      if (gatewayOutput.join("").length < 100_000) {
        gatewayOutput.push(String(chunk));
      }
    });
  }

  let gatewayReady = false;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    if (gatewayProcess.exitCode !== null) break;
    try {
      await runCli(
        ["gateway", "call", "health", "--json", "--timeout", "1000"],
        10_000,
      );
      gatewayReady = true;
      break;
    } catch {
      await delay(250);
    }
  }
  assert.equal(
    gatewayReady,
    true,
    `gateway failed to start:\n${gatewayOutput.join("")}`,
  );

  progress("invoking a tool through the gateway with the SecretRef");
  const invocation = parseJsonOutput(
    (
      await runCli([
        "gateway",
        "call",
        "tools.invoke",
        "--json",
        "--timeout",
        "30000",
        "--params",
        JSON.stringify({ name: "home_assistant_diagnose", args: {} }),
      ])
    ).stdout,
    "tools.invoke",
  );
  assert.equal(invocation.ok, true, JSON.stringify(invocation));
  assert.match(JSON.stringify(invocation), /"reachable":true/);
  assert.equal(authorizationHeaders.length, 2);
  assert.deepEqual(
    [...new Set(authorizationHeaders)],
    [`Bearer ${compatibilityToken}`],
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        artifact: packResults[0].filename,
        bundledSkill: "home-assistant-interface",
        host: targetName,
        hostVersion: target.version,
        outputSchemas: target.outputSchemaCount,
        secretRef: {
          materialized: true,
          source: "env",
          storedAsReference: true,
        },
        tools: expectedToolNames,
      },
      null,
      2,
    )}\n`,
  );
  progress("compatibility assertions passed");
} finally {
  progress("cleaning up the isolated profile");
  await stopChild(gatewayProcess);
  if (homeAssistantServer?.listening) {
    const closed = new Promise((resolve, reject) =>
      homeAssistantServer.close((error) => (error ? reject(error) : resolve())),
    );
    homeAssistantServer.closeIdleConnections();
    for (const socket of homeAssistantSockets) socket.destroy();
    await closed;
  }
  await rm(workspace, { force: true, recursive: true });
  progress("cleanup complete");
}
