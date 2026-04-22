import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createAuditLedger } from "../audit/auditLedger.js";
import type { PolicyPatchV0 } from "../policy/policyTypes.js";

export type ProposalKind = "protocol_unknown" | "protocol_violation" | "policy_suggestion";

export type ProposalRecordV0 = {
  v: 0;
  ts: number;
  kind: ProposalKind;
  scope: string;
  reason: string;
  unknownType?: string;
  summary?: unknown;
  patch?: PolicyPatchV0;
  suggestedChanges?: {
    /**
     * Human-reviewable hints; proposals are never auto-applied.
     */
    protocol?: { addEventType?: string; tightenValidation?: boolean };
    capabilityProfile?: { forceSafeMode?: boolean; safeModeAllowlistAdd?: string[] };
  };
  digests?: {
    summaryDigest?: string;
  };
};

export function writeProposal(args: {
  runsDir?: string;
  kind: ProposalKind;
  scope: string;
  reason: string;
  unknownType?: string;
  summary?: unknown;
}): { path: string; record: ProposalRecordV0 } {
  const runsDir = args.runsDir ?? join(process.cwd(), "runs");
  const proposalsDir = join(runsDir, "proposals");
  mkdirSync(proposalsDir, { recursive: true });

  const audit = createAuditLedger({ runsDir });

  const suggestedChanges: ProposalRecordV0["suggestedChanges"] =
    args.kind === "protocol_unknown" || args.kind === "protocol_violation"
      ? {
          protocol:
            args.reason === "unknown_event_type" && args.unknownType
              ? { addEventType: args.unknownType }
              : { tightenValidation: true },
          capabilityProfile: { forceSafeMode: true },
        }
      : undefined;

  const patch: PolicyPatchV0 | undefined =
    args.kind === "protocol_unknown" || args.kind === "protocol_violation"
      ? {
          v: 0,
          protocol:
            args.reason === "unknown_event_type" && args.unknownType ? { addKnownEventTypes: [args.unknownType] } : { setStrictness: "strict" },
        }
      : undefined;

  const record: ProposalRecordV0 = {
    v: 0,
    ts: Date.now(),
    kind: args.kind,
    scope: args.scope,
    reason: args.reason,
    unknownType: args.unknownType,
    summary: args.summary,
    patch,
    suggestedChanges,
    digests: args.summary === undefined ? undefined : { summaryDigest: audit.digestJson(args.summary) },
  };

  const filename = `proposal-${record.ts}-${record.kind}.json`;
  const path = join(proposalsDir, filename);
  writeFileSync(path, JSON.stringify(record, null, 2) + "\n", { encoding: "utf8" });
  return { path, record };
}

