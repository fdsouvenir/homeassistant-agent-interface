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
});
