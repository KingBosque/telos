import type { AgentHarnessAttemptParams } from "openclaw/plugin-sdk/agent-harness";

/**
 * OpenClaw's public `AgentHarnessAttemptParams` is a large embedded-run shape; this
 * harness also reads a few optional fields that are not stable across SDK revisions.
 * Keep all "loose" reads in one place instead of scattering `as any`.
 */
export type ArcaneHarnessAttemptExtras = {
  sessionId?: string;
  openclawSessionId?: string;
  transcriptPath?: string;
  trigger?: { source?: unknown; id?: unknown };
  intent?: unknown;
  objective?: unknown;
  untrustedContext?: unknown;
  expectedSideEffects?: unknown;
  capabilityProfile?: unknown;
  sandbox?: unknown;
  toolPolicy?: unknown;
  model?: unknown;
  provider?: unknown;
};

export type ArcaneHarnessAttemptParams = AgentHarnessAttemptParams & ArcaneHarnessAttemptExtras;

export function asArcaneAttemptParams(params: AgentHarnessAttemptParams): ArcaneHarnessAttemptParams {
  return params as ArcaneHarnessAttemptParams;
}
