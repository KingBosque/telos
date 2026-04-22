import { createHash } from "node:crypto";
import { mkdirSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type AuditMode = "active" | "degraded" | "safe_mode" | "recovery";
export type AuditTriggerSource = "schedule" | "event" | "tension" | "interactive" | "unknown";

export type AuditToolEvent = {
  name: string;
  callId: string;
  approved: boolean | "unknown";
  policyBasis?: { reason: string; detailsDigest?: string };
  reason?: string;
  expectedSideEffects?: string[];
  dataProvenance?: string;
  argumentsDigest?: string;
  resultDigest?: string;
  status: "ok" | "error";
};

export type AuditRecordV0 = {
  v: 0;
  ts: number;
  openclawSessionId: string;
  attemptId: string;
  mode: AuditMode;
  trigger: { source: AuditTriggerSource; id?: string };
  intent: string;
  expectedSideEffects: string[];
  tool?: AuditToolEvent;
  notes?: Record<string, unknown>;
};

export type AuditLedger = {
  append: (rec: Omit<AuditRecordV0, "v" | "ts"> & { ts?: number }) => void;
  digestJson: (value: unknown) => string;
  ledgerPathForDate: (d?: Date) => string;
};

export function createAuditLedger(opts?: { runsDir?: string }): AuditLedger {
  const runsDir = opts?.runsDir ?? join(process.cwd(), "runs");
  mkdirSync(runsDir, { recursive: true });

  function ledgerPathForDate(d = new Date()): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return join(runsDir, `audit-${yyyy}-${mm}-${dd}.ndjson`);
  }

  function digestJson(value: unknown): string {
    const json = stableJson(value);
    return `sha256:${createHash("sha256").update(json).digest("hex")}`;
  }

  function append(rec: Omit<AuditRecordV0, "v" | "ts"> & { ts?: number }) {
    const full: AuditRecordV0 = {
      v: 0,
      ts: rec.ts ?? Date.now(),
      openclawSessionId: rec.openclawSessionId,
      attemptId: rec.attemptId,
      mode: rec.mode,
      trigger: rec.trigger,
      intent: rec.intent,
      expectedSideEffects: rec.expectedSideEffects,
      tool: rec.tool,
      notes: rec.notes,
    };

    const path = ledgerPathForDate(new Date(full.ts));
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(full) + "\n", { encoding: "utf8" });
  }

  return { append, digestJson, ledgerPathForDate };
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) out[key] = sortKeysDeep(obj[key]);
  return out;
}

