import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createArcaneHarness } from "./harness.js";

export default definePluginEntry({
  id: "arcane-native-agent",
  name: "Arcane Native Agent Harness",
  description: "Runs prepared OpenClaw attempts through a native runtime (echo CLI starter).",
  register(api) {
    api.registerAgentHarness(createArcaneHarness());
  },
});

