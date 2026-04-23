import type { AgentHarnessAttemptParams } from "openclaw/plugin-sdk/agent-harness";

/**
 * Optional fields this harness may read that are not on OpenClaw's
 * `AgentHarnessAttemptParams` (or that we want as `unknown` without widening
 * the whole tree).
 *
 * **Do not add `trigger` here** — the SDK already defines `trigger` as
 * `EmbeddedRunTrigger` (string union). Intersecting a different `trigger` shape
 * makes `trigger` become `never` and breaks honest typing.
 */
export type ArcaneHarnessLooseFields = {
  openclawSessionId?: string;
  transcriptPath?: string;
  intent?: unknown;
  objective?: unknown;
  untrustedContext?: unknown;
  expectedSideEffects?: unknown;
  capabilityProfile?: unknown;
  sandbox?: unknown;
  toolPolicy?: unknown;
};

export type ArcaneAttemptParams = AgentHarnessAttemptParams & ArcaneHarnessLooseFields;

export function asArcaneAttemptParams(params: AgentHarnessAttemptParams): ArcaneAttemptParams {
  return params as ArcaneAttemptParams;
}
