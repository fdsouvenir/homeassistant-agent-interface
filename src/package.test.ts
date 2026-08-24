import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(new URL(path, root), "utf8")) as Record<
    string,
    unknown
  >;
}

describe("published plugin package", () => {
  it("ships the Home Assistant operating skill", async () => {
    const manifest = await readJson("openclaw.plugin.json");
    const packageJson = await readJson("package.json");
    const skill = await readFile(
      new URL("skills/home-assistant-interface/SKILL.md", root),
      "utf8",
    );

    expect(manifest.skills).toEqual(["./skills"]);
    expect(packageJson.files).toEqual(expect.arrayContaining(["skills"]));
    expect(skill).toContain("name: home-assistant-interface");
    for (const tool of [
      "home_assistant_brief",
      "home_assistant_find",
      "home_assistant_execute",
      "home_assistant_inspect",
      "home_assistant_presence",
      "home_assistant_diagnose",
    ]) {
      expect(skill).toContain(`\`${tool}\``);
    }
  });

  it("supports stable hosts while building enhanced schemas with beta", async () => {
    const packageJson = await readJson("package.json");
    const peerDependencies = packageJson.peerDependencies as Record<
      string,
      unknown
    >;
    const openclaw = packageJson.openclaw as {
      build: Record<string, unknown>;
      compat: Record<string, unknown>;
      install: Record<string, unknown>;
    };

    expect(peerDependencies.openclaw).toBe(">=2026.7.1-2");
    expect(openclaw.install.minHostVersion).toBe(">=2026.7.1-2");
    expect(openclaw.compat.pluginApi).toBe(">=2026.7.1-2");
    expect(openclaw.build).toMatchObject({
      openclawVersion: "2026.8.1-beta.2",
      pluginSdkVersion: "2026.8.1-beta.2",
    });
  });

  it("allows installation before required Home Assistant settings are supplied", async () => {
    const manifest = await readJson("openclaw.plugin.json");
    const configSchema = manifest.configSchema as Record<string, unknown>;
    const toolMetadata = manifest.toolMetadata as Record<
      string,
      { configSignals: Array<{ required: string[] }> }
    >;

    expect(configSchema.required).toBeUndefined();
    for (const metadata of Object.values(toolMetadata)) {
      expect(metadata.configSignals[0]?.required).toEqual(["baseUrl", "token"]);
    }
  });
});
