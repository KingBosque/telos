import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ArcanePolicyV0, PolicyOverridesV0, PolicyPatchV0 } from "./policyTypes.js";

function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function uniqStrings(xs: string[]): string[] {
  return [...new Set(xs)].sort();
}

export function defaultPolicy(): ArcanePolicyV0 {
  return {
    v: 0,
    protocol: {
      strictness: "permissive",
      knownEventTypes: ["partial_reply", "agent_event", "handshake", "tool_call", "tool_result", "budget", "heartbeat", "final"].sort(),
    },
    sandbox: {
      ttlMsDefault: 15 * 60_000,
      maxActiveSandboxPatches: 8,
    },
  };
}

export function readJsonFile(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function ensureRepoPolicyFile(args?: { rootDir?: string }): string {
  const rootDir = args?.rootDir ?? process.cwd();
  const dir = join(rootDir, "config");
  const path = join(dir, "arcane-policy.json");
  mkdirSync(dir, { recursive: true });
  const existing = readJsonFile(path);
  if (!existing) writeFileSync(path, JSON.stringify(defaultPolicy(), null, 2) + "\n", { encoding: "utf8" });
  return path;
}

export function ensureOverridesFile(args?: { runsDir?: string }): string {
  const runsDir = args?.runsDir ?? join(process.cwd(), "runs");
  mkdirSync(runsDir, { recursive: true });
  const path = join(runsDir, "policy-overrides.json");
  const existing = readJsonFile(path);
  if (!existing) {
    const init: PolicyOverridesV0 = { v: 0, patches: [] };
    writeFileSync(path, JSON.stringify(init, null, 2) + "\n", { encoding: "utf8" });
  }
  return path;
}

export function applyPatch(policy: ArcanePolicyV0, patch: PolicyPatchV0): ArcanePolicyV0 {
  if (patch.v !== 0) return policy;
  let next: ArcanePolicyV0 = structuredClone(policy);

  if (patch.protocol?.setStrictness) next.protocol.strictness = patch.protocol.setStrictness;
  if (patch.protocol?.addKnownEventTypes?.length) {
    next.protocol.knownEventTypes = uniqStrings([...next.protocol.knownEventTypes, ...patch.protocol.addKnownEventTypes.map(String)]);
  }

  if (patch.capabilityProfiles?.safe_mode?.allowlistAdd?.length) {
    // We don’t yet have a full persisted capability profile in policy; treat this as protocol metadata for now.
    // Future: merge into modeMachine/defaultModeConfig profiles.
    void next;
  }

  return next;
}

export function loadPolicy(args?: {
  rootDir?: string;
  runsDir?: string;
  nowMs?: number;
  scope?: { openclawSessionId?: string; nativeThreadId?: string };
}): {
  policy: ArcanePolicyV0;
  sources: { repoPolicyPath: string; overridesPath: string; appliedPatchIds: string[]; droppedPatchIds: string[] };
  derived: { safeModeAllowlistAdd: string[] };
} {
  const rootDir = args?.rootDir ?? process.cwd();
  const runsDir = args?.runsDir ?? join(rootDir, "runs");
  const nowMs = args?.nowMs ?? Date.now();
  const scope = args?.scope;

  const repoPolicyPath = ensureRepoPolicyFile({ rootDir });
  const overridesPath = ensureOverridesFile({ runsDir });

  const repoRaw = readJsonFile(repoPolicyPath);
  const base = isRecord(repoRaw) && repoRaw.v === 0 ? (repoRaw as ArcanePolicyV0) : defaultPolicy();

  const overridesRaw = readJsonFile(overridesPath);
  const overrides = isRecord(overridesRaw) && overridesRaw.v === 0 ? (overridesRaw as PolicyOverridesV0) : { v: 0, patches: [] };

  const appliedPatchIds: string[] = [];
  const droppedPatchIds: string[] = [];
  const safeModeAllowlistAdd: string[] = [];

  let next = structuredClone(base);
  const patches = Array.isArray(overrides.patches) ? overrides.patches : [];
  for (const p of patches) {
    if (!p || typeof p !== "object") continue;
    const id = typeof (p as any).id === "string" ? (p as any).id : "unknown";
    const expiresAt = typeof (p as any).expiresAt === "number" ? (p as any).expiresAt : 0;
    if (expiresAt && expiresAt <= nowMs) {
      droppedPatchIds.push(id);
      continue;
    }

    const patchScope = (p as any).scope;
    const scoped =
      isRecord(patchScope) && (patchScope.global === true || !scope
        ? true
        : (typeof patchScope.openclawSessionId === "string" && patchScope.openclawSessionId === scope.openclawSessionId) ||
          (typeof patchScope.nativeThreadId === "string" && patchScope.nativeThreadId === scope.nativeThreadId));
    if (!scoped) continue;

    const patch = (p as any).patch as PolicyPatchV0 | undefined;
    if (!patch || patch.v !== 0) continue;
    next = applyPatch(next, patch);
    appliedPatchIds.push(id);

    if (patch.capabilityProfiles?.safe_mode?.allowlistAdd?.length) {
      safeModeAllowlistAdd.push(...patch.capabilityProfiles.safe_mode.allowlistAdd.map(String));
    }
  }

  return {
    policy: next,
    sources: { repoPolicyPath, overridesPath, appliedPatchIds, droppedPatchIds },
    derived: { safeModeAllowlistAdd: uniqStrings(safeModeAllowlistAdd) },
  };
}

