import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function isRecord(x) {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8" });
}

function nowMs() {
  return Date.now();
}

function main() {
  const runsDir = process.env.ARCANE_RUNS_DIR ? String(process.env.ARCANE_RUNS_DIR) : join(process.cwd(), "runs");
  const overridesPath = join(runsDir, "policy-overrides.json");
  mkdirSync(runsDir, { recursive: true });

  const proposalPath = process.argv[2];
  if (!proposalPath) {
    throw new Error("Usage: node scripts/sandbox-apply-proposal.js <proposal.json> [ttlMs] [scopeKey=scopeValue...]");
  }

  const proposal = readJson(resolve(proposalPath));
  if (!isRecord(proposal) || proposal.v !== 0) throw new Error("Unsupported proposal format");
  if (!isRecord(proposal.patch) || proposal.patch.v !== 0) throw new Error("Proposal has no usable patch (patch.v must be 0)");

  const ttlMsArg = process.argv[3];
  const ttlMs = ttlMsArg ? Math.max(1, Number(ttlMsArg)) : 15 * 60_000;
  if (!Number.isFinite(ttlMs)) throw new Error("ttlMs must be a number");

  const scope = {};
  for (const kv of process.argv.slice(4)) {
    const [k, ...rest] = String(kv).split("=");
    const v = rest.join("=");
    if (!k) continue;
    if (k === "global") scope.global = v === "true";
    else if (k === "openclawSessionId") scope.openclawSessionId = v;
    else if (k === "nativeThreadId") scope.nativeThreadId = v;
  }
  if (Object.keys(scope).length === 0) scope.global = true;

  let overrides;
  try {
    overrides = readJson(overridesPath);
  } catch {
    overrides = { v: 0, patches: [] };
  }
  if (!isRecord(overrides) || overrides.v !== 0 || !Array.isArray(overrides.patches)) {
    overrides = { v: 0, patches: [] };
  }

  const id = `sandbox-${proposal.ts ?? nowMs()}-${proposal.kind ?? "proposal"}`;
  const ts = nowMs();
  const expiresAt = ts + ttlMs;

  overrides.patches.push({
    id,
    ts,
    expiresAt,
    scope,
    patch: proposal.patch,
  });

  writeJson(overridesPath, overrides);
  process.stdout.write(`Applied ${id} to ${overridesPath}\n`);
}

main();

