import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseNdjsonLine } from "./attemptPayload.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

export function runAttemptPayloadFixtureTest(): void {
  const fixture = join(process.cwd(), "runs", "protocol-unknown-fixture.ndjson");
  const lines = readFileSync(fixture, "utf8").split(/\r?\n/).filter((l) => l.trim().length > 0);

  const parsed = lines.map((l) => parseNdjsonLine(l)).filter(Boolean);
  assert(parsed.length === 3, "expected 3 parsed entries");

  assert(parsed[0]?.kind === "event" && parsed[0].event.type === "partial_reply", "expected partial_reply event");
  assert(parsed[1]?.kind === "unknown", "expected invalid tool_call to be unknown");
  assert(parsed[2]?.kind === "unknown" && parsed[2].reason === "unknown_event_type", "expected unknown event type to be unknown");
}

if (process.argv.includes("--run")) {
  runAttemptPayloadFixtureTest();
  process.stdout.write("ok\n");
}

