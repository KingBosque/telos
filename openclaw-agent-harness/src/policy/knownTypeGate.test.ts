import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadPolicy } from "./loadPolicy.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

export function runKnownTypeGateFixtureTest(): void {
  const rootDir = join(process.cwd(), "runs", "tmp-known-type-test-root");
  const runsDir = join(rootDir, "runs");
  mkdirSync(join(rootDir, "config"), { recursive: true });
  mkdirSync(runsDir, { recursive: true });

  writeFileSync(
    join(rootDir, "config", "arcane-policy.json"),
    JSON.stringify(
      {
        v: 0,
        protocol: { strictness: "strict", knownEventTypes: ["final"] },
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
            id: "allow-foo",
            ts: 1,
            expiresAt: 999999,
            scope: { global: true },
            patch: { v: 0, protocol: { addKnownEventTypes: ["foo"] } },
          },
        ],
      },
      null,
      2,
    ) + "\n",
    { encoding: "utf8" },
  );

  const out = loadPolicy({ rootDir, runsDir, nowMs: 2 });
  assert(out.policy.protocol.strictness === "strict", "expected strictness to remain strict");
  assert(out.policy.protocol.knownEventTypes.includes("foo"), "expected foo to be added to knownEventTypes");
}

if (process.argv.includes("--run")) {
  runKnownTypeGateFixtureTest();
  process.stdout.write("ok\n");
}

