import type { AgentHarnessAttemptParams, AgentHarnessAttemptResult } from "openclaw/plugin-sdk/agent-harness";

/**
 * OpenClaw's typed `onAgentEvent` is `{ stream, data }`; in practice the host
 * still receives richer objects from some paths. The harness uses custom
 * `kind`-shaped events — keep the escape hatch in *one* place.
 */
export function emitHarnessAgentEvent(p: AgentHarnessAttemptParams, evt: unknown): void {
  const on = (p as { onAgentEvent?: (e: unknown) => void }).onAgentEvent;
  on?.(evt);
}

/**
 * The SDK's `AgentHarnessAttemptResult` is the full `EmbeddedRunAttemptResult`.
 * This custom harness only supplies the narrow `{ text, native }` shape the
 * local runner expects; the cast documents that contract.
 */
export function asNarrowHarnessAttemptResult(
  r: { text: string; native: unknown },
): AgentHarnessAttemptResult {
  return r as unknown as AgentHarnessAttemptResult;
}
