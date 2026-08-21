import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import {
  runBrief,
  runDiagnose,
  runFind,
  runInspect,
  runPresence,
} from "./operations.js";
import {
  briefOutputSchema,
  briefParameters,
  configSchema,
  diagnoseOutputSchema,
  diagnoseParameters,
  findOutputSchema,
  findParameters,
  inspectOutputSchema,
  inspectParameters,
  presenceOutputSchema,
  presenceParameters,
} from "./schemas.js";

export default defineToolPlugin({
  id: "homeassistant-agent-interface",
  name: "Home Assistant Agent Interface",
  description:
    "Secure, compact Home Assistant context shaped for agent decisions.",
  activation: { onStartup: false },
  configSchema,
  tools: (tool) => [
    tool({
      name: "home_assistant_brief",
      label: "Home Assistant Brief",
      description:
        "Return a compact household briefing for explicit or configured entities: current states, attention items, presence, and recent changes. Use this before issuing multiple reads.",
      parameters: briefParameters,
      outputSchema: briefOutputSchema,
      execute: (params, config, context) => runBrief(params, config, context),
    }),
    tool({
      name: "home_assistant_find",
      label: "Find Home Assistant Entities",
      description:
        "Resolve a name or partial entity reference to a bounded list of canonical Home Assistant entity IDs. Returns definitive empty results and pagination metadata.",
      parameters: findParameters,
      outputSchema: findOutputSchema,
      execute: (params, config, context) => runFind(params, config, context),
    }),
    tool({
      name: "home_assistant_inspect",
      label: "Inspect Home Assistant Context",
      description:
        "Inspect up to 25 Home Assistant targets in one call using safe, type-aware projections. Increase detail only when the default projection is insufficient.",
      parameters: inspectParameters,
      outputSchema: inspectOutputSchema,
      execute: (params, config, context) => runInspect(params, config, context),
    }),
    tool({
      name: "home_assistant_presence",
      label: "Home Assistant Presence",
      description:
        "Return current zones and a bounded transition/time-by-zone summary for explicit or configured person and device_tracker entities. Precise coordinates are never returned.",
      parameters: presenceParameters,
      outputSchema: presenceOutputSchema,
      optional: true,
      execute: (params, config, context) =>
        runPresence(params, config, context),
    }),
    tool({
      name: "home_assistant_diagnose",
      label: "Diagnose Home Assistant",
      description:
        "Check Home Assistant connectivity and summarize scoped entity health without exposing raw configuration, logs, coordinates, or credentials.",
      parameters: diagnoseParameters,
      outputSchema: diagnoseOutputSchema,
      optional: true,
      execute: (params, config, context) =>
        runDiagnose(params, config, context),
    }),
  ],
});
