import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";
import { describe, expect, it } from "vitest";
import entry from "./index.js";

describe("Home Assistant Agent Interface plugin", () => {
  it("declares the stable semantic tool surface", () => {
    const metadata = getToolPluginMetadata(entry);
    expect(metadata).toMatchObject({
      id: "homeassistant-agent-interface",
      activation: { onStartup: false },
    });
    expect(metadata?.tools.map((tool) => tool.name)).toEqual([
      "home_assistant_brief",
      "home_assistant_find",
      "home_assistant_inspect",
      "home_assistant_presence",
      "home_assistant_diagnose",
    ]);
    expect(
      metadata?.tools.every((tool) => tool.outputSchema !== undefined),
    ).toBe(true);
    expect(
      metadata?.tools.filter((tool) => tool.optional).map((tool) => tool.name),
    ).toEqual(["home_assistant_presence", "home_assistant_diagnose"]);
  });
});
