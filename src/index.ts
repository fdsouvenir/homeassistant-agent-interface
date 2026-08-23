import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import {
  runBrief,
  runDiagnose,
  runExecute,
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
  executeOutputSchema,
  executeParameters,
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
    "Compact Home Assistant discovery, context, history, and action execution for agents.",
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
        "Search the live Home Assistant catalog for entities, actions, areas, devices, floors, and labels. Filter by kind when possible; omit query to browse a bounded page.",
      parameters: findParameters,
      outputSchema: findOutputSchema,
      execute: (params, config, context) => runFind(params, config, context),
    }),
    tool({
      name: "home_assistant_execute",
      label: "Execute Home Assistant Action",
      description:
        "Execute any Home Assistant action available to the configured token. Discover action names and fields with home_assistant_find, pass native Home Assistant targets and data, and receive a compact before/after observation when target entities can be resolved.",
      parameters: executeParameters,
      outputSchema: executeOutputSchema,
      execute: (params, config, context) => runExecute(params, config, context),
    }),
    tool({
      name: "home_assistant_inspect",
      label: "Inspect Home Assistant Context",
      description:
        "Inspect up to 25 Home Assistant entities in one call using type-aware projections. Request exact attribute_keys only when the normal projection lacks needed context.",
      parameters: inspectParameters,
      outputSchema: inspectOutputSchema,
      execute: (params, config, context) => runInspect(params, config, context),
    }),
    tool({
      name: "home_assistant_presence",
      label: "Home Assistant Presence",
      description:
        "Return current zones and a bounded transition/time-by-zone summary for explicit or configured person and device_tracker entities.",
      parameters: presenceParameters,
      outputSchema: presenceOutputSchema,
      execute: (params, config, context) =>
        runPresence(params, config, context),
    }),
    tool({
      name: "home_assistant_diagnose",
      label: "Diagnose Home Assistant",
      description:
        "Check Home Assistant connectivity and summarize instance and entity health in one compact result.",
      parameters: diagnoseParameters,
      outputSchema: diagnoseOutputSchema,
      execute: (params, config, context) =>
        runDiagnose(params, config, context),
    }),
  ],
});
