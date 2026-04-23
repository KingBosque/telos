import type { AgentHarnessAttemptParams } from "openclaw/plugin-sdk/agent-harness";
import type { TriggerSource } from "./serde/attemptPayload.js";

/** OpenClaw `RunEmbeddedPiAgentParams.trigger` */
type EmbeddedRunTrigger = NonNullable<AgentHarnessAttemptParams["trigger"]>;

/**
 * Map OpenClaw's string trigger to the harness daemon payload's
 * `TriggerSource` (different vocabulary on purpose).
 */
export function attemptTriggerForPayload(
  p: AgentHarnessAttemptParams,
  fallbacks: { attemptId: string },
): { source: TriggerSource; id?: string } {
  const t = p.trigger;
  const id = typeof p.sessionKey === "string" && p.sessionKey ? p.sessionKey : fallbacks.attemptId;
  if (!t) {
    return { source: "unknown", id };
  }
  const map: Record<EmbeddedRunTrigger, TriggerSource> = {
    cron: "schedule",
    heartbeat: "event",
    manual: "interactive",
    user: "interactive",
    memory: "tension",
    overflow: "tension",
  };
  return { source: map[t] ?? "unknown", id };
}
