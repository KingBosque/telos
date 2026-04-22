import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function isRecord(x) {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function readNdjson(path) {
  const text = readFileSync(path, "utf8");
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      out.push({ _parseError: true, _rawLength: trimmed.length });
    }
  }
  return out;
}

function safeList(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function main() {
  const runsDir = process.argv[2] ? String(process.argv[2]) : join(process.cwd(), "runs");
  const reportsDir = join(runsDir, "reports");
  mkdirSync(reportsDir, { recursive: true });

  const auditFiles = safeList(runsDir).filter((n) => n.startsWith("audit-") && n.endsWith(".ndjson")).map((n) => join(runsDir, n));
  const proposalFiles = safeList(join(runsDir, "proposals"))
    .filter((n) => n.startsWith("proposal-") && n.endsWith(".json"))
    .map((n) => join(runsDir, "proposals", n));

  const audit = [];
  for (const f of auditFiles) audit.push(...readNdjson(f));

  const proposals = [];
  for (const f of proposalFiles) {
    try {
      proposals.push(JSON.parse(readFileSync(f, "utf8")));
    } catch {
      proposals.push({ _parseError: true, path: f });
    }
  }

  const toolFailuresByName = new Map();
  const toolErrorsByCode = new Map();
  for (const rec of audit) {
    if (!isRecord(rec) || !isRecord(rec.tool)) continue;
    const tool = rec.tool;
    if (tool.status !== "error") continue;
    const name = typeof tool.name === "string" ? tool.name : "unknown";
    toolFailuresByName.set(name, (toolFailuresByName.get(name) ?? 0) + 1);
    const code = isRecord(rec.notes?.error) && typeof rec.notes.error.code === "string" ? rec.notes.error.code : "unknown";
    toolErrorsByCode.set(code, (toolErrorsByCode.get(code) ?? 0) + 1);
  }

  const proposalCounts = new Map();
  for (const p of proposals) {
    const reason = isRecord(p) && typeof p.reason === "string" ? p.reason : "unknown";
    proposalCounts.set(reason, (proposalCounts.get(reason) ?? 0) + 1);
  }

  const top = (m, n = 10) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, v]) => ({ key: k, count: v }));

  const summary = {
    v: 0,
    generatedAt: Date.now(),
    runsDir,
    inputs: { auditFiles, proposalFiles, auditRecords: audit.length, proposals: proposals.length },
    unknowns: {
      proposalsByReason: top(proposalCounts, 20),
    },
    failures: {
      toolFailuresByName: top(toolFailuresByName, 20),
      toolErrorsByCode: top(toolErrorsByCode, 20),
    },
    suggestedDiffs: [
      ...top(proposalCounts, 5).map((p) => ({
        kind: "protocol",
        reason: p.key,
        suggestion: "Review proposals and update protocol validator / event registry accordingly.",
      })),
      ...top(toolFailuresByName, 5).map((t) => ({
        kind: "capabilityProfile",
        tool: t.key,
        suggestion: "If this failure is due to missing diagnostics, consider adding a read-only diagnostic tool to safe_mode allowlist.",
      })),
    ],
  };

  const jsonPath = join(reportsDir, "unknowns.json");
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2) + "\n", { encoding: "utf8" });

  const md = [
    `# Unknowns report`,
    ``,
    `Generated: ${new Date(summary.generatedAt).toISOString()}`,
    `Runs dir: ${runsDir}`,
    ``,
    `## Proposal reasons (top)`,
    ...summary.unknowns.proposalsByReason.map((x) => `- ${x.key}: ${x.count}`),
    ``,
    `## Tool failures (top)`,
    ...summary.failures.toolFailuresByName.map((x) => `- ${x.key}: ${x.count}`),
    ``,
    `## Suggested diffs`,
    ...summary.suggestedDiffs.map((x) => `- (${x.kind}) ${x.suggestion}`),
    ``,
  ].join("\n");
  writeFileSync(join(reportsDir, "unknowns.md"), md, { encoding: "utf8" });

  process.stdout.write(`Wrote ${jsonPath}\n`);
}

main();

