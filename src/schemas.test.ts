import { describe, expect, it } from "vitest";
import { Check } from "typebox/value";
import { configSchema, secretInputSchema } from "./schemas.js";

describe("Home Assistant credential schema", () => {
  it.each([
    ["plaintext", "test-token"],
    [
      "environment SecretRef",
      { source: "env", provider: "default", id: "HOME_ASSISTANT_TOKEN" },
    ],
    [
      "file JSON-pointer SecretRef",
      {
        source: "file",
        provider: "mounted-json",
        id: "/homeAssistant/token",
      },
    ],
    [
      "single-value file SecretRef",
      { source: "file", provider: "mounted-token", id: "value" },
    ],
    [
      "exec SecretRef",
      {
        source: "exec",
        provider: "keepassxc",
        id: "home-assistant/token",
      },
    ],
    [
      "store SecretRef",
      { source: "store", provider: "default", id: "HOME_ASSISTANT_TOKEN" },
    ],
  ])("accepts %s", (_label, value) => {
    expect(Check(secretInputSchema, value)).toBe(true);
    expect(Check(configSchema, { token: value })).toBe(true);
  });

  it.each([
    ["empty plaintext", ""],
    ["arbitrary object", { secret: "test-token" }],
    [
      "additional property",
      {
        source: "env",
        provider: "default",
        id: "HOME_ASSISTANT_TOKEN",
        value: "test-token",
      },
    ],
    [
      "invalid provider",
      { source: "env", provider: "KeePassXC", id: "HOME_ASSISTANT_TOKEN" },
    ],
    [
      "lowercase environment id",
      { source: "env", provider: "default", id: "home_assistant_token" },
    ],
    [
      "invalid file pointer escape",
      { source: "file", provider: "mounted-json", id: "/home~2token" },
    ],
    [
      "exec traversal",
      { source: "exec", provider: "keepassxc", id: "home/../token" },
    ],
    [
      "unknown source",
      { source: "vault", provider: "keepassxc", id: "home-assistant" },
    ],
  ])("rejects %s", (_label, value) => {
    expect(Check(secretInputSchema, value)).toBe(false);
  });
});
