import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadPolicy } from "./loadPolicy.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

export function runPolicyMergeFixtureTest(): void {
  const rootDir = join(process.cwd(), "runs", "tmp-policy-test-root");
  const runsDir = join(rootDir, "runs");
  mkdirSync(join(rootDir, "config"), { recursive: true });
  mkdirSync(runsDir, { recursive: true });

  writeFileSync(
    join(rootDir, "config", "arcane-policy.json"),
    JSON.stringify(
      {
        v: 0,
        protocol: { strictness: "permissive", knownEventTypes: ["final"] },
        sandbox: { ttlMsDefault: 1000, maxActiveSandboxPatches: 8 },
      },
      null,
      2,
    ) + "\n",
    { encoding: "utf8" },
  );

  writeFileSync(
    join(runsDir, "policy-overrides.json"),
    JSON.stringify(
      {
        v: 0,
        patches: [
          {
            id: "expired",
            ts: 1,
            expiresAt: 2,
            scope: { global: true },
            patch: { v: 0, protocol: { addKnownEventTypes: ["tool_call"] } },
          },
          {
            id: "active",
            ts: 10,
            expiresAt: 999999,
            scope: { global: true },
            patch: { v: 0, protocol: { addKnownEventTypes: ["tool_call"] } },
          },
        ],
      },
      null,
      2,
    ) + "\n",
    { encoding: "utf8" },
  );

  const { policy, sources } = loadPolicy({ rootDir, runsDir, nowMs: 100, scope: { openclawSessionId: "s", nativeThreadId: "t" } });
  assert(sources.droppedPatchIds.includes("expired"), "expected expired patch to be dropped");
  assert(sources.appliedPatchIds.includes("active"), "expected active patch to be applied");
  assert(policy.protocol.knownEventTypes.includes("final"), "expected base known event");
  assert(policy.protocol.knownEventTypes.includes("tool_call"), "expected patched known event");
}

if (process.argv.includes("--run")) {
  runPolicyMergeFixtureTest();
  process.stdout.write("ok\n");
}

