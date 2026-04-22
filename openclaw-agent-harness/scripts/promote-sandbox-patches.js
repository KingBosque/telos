import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function isRecord(x) {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function uniq(xs) {
  return [...new Set(xs)].sort();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8" });
}

function applyPatch(policy, patch) {
  if (!isRecord(patch) || patch.v !== 0) return policy;
  const next = JSON.parse(JSON.stringify(policy));

  if (isRecord(patch.protocol)) {
    if (typeof patch.protocol.setStrictness === "string") next.protocol.strictness = patch.protocol.setStrictness;
    if (Array.isArray(patch.protocol.addKnownEventTypes)) {
      next.protocol.knownEventTypes = uniq([
        ...(Array.isArray(next.protocol.knownEventTypes) ? next.protocol.knownEventTypes : []),
        ...patch.protocol.addKnownEventTypes.map(String),
      ]);
    }
  }

  return next;
}

function main() {
  const rootDir = process.env.ARCANE_ROOT_DIR ? String(process.env.ARCANE_ROOT_DIR) : process.cwd();
  const runsDir = process.env.ARCANE_RUNS_DIR ? String(process.env.ARCANE_RUNS_DIR) : join(rootDir, "runs");
  const overridesPath = join(runsDir, "policy-overrides.json");
  const repoPolicyPath = join(rootDir, "config", "arcane-policy.json");
  const reportsDir = join(runsDir, "reports");
  mkdirSync(reportsDir, { recursive: true });

  const overrides = readJson(overridesPath);
  if (!isRecord(overrides) || overrides.v !== 0 || !Array.isArray(overrides.patches)) {
    throw new Error("Invalid overrides file");
  }

  const base = readJson(repoPolicyPath);
  if (!isRecord(base) || base.v !== 0) throw new Error("Invalid repo policy");

  // Promotion policy: only patches explicitly marked promote=true OR global patches (opt-in) with no expiry yet.
  const promotable = overrides.patches.filter((p) => {
    if (!isRecord(p)) return false;
    if (p.promote === true) return true;
    return isRecord(p.scope) && p.scope.global === true && typeof p.expiresAt === "number" && p.expiresAt > Date.now();
  });

  let next = JSON.parse(JSON.stringify(base));
  const appliedIds = [];
  for (const p of promotable) {
    next = applyPatch(next, p.patch);
    if (typeof p.id === "string") appliedIds.push(p.id);
  }

  const out = {
    v: 0,
    generatedAt: Date.now(),
    repoPolicyPath,
    overridesPath,
    appliedPatchIds: appliedIds.sort(),
    proposedRepoPolicy: next,
  };

  const outPath = join(reportsDir, "promotion.json");
  writeJson(outPath, out);
  process.stdout.write(`Wrote ${outPath}\n`);
}

main();

