import { createInterface } from "node:readline";

type Input = {
  v: 0;
  attemptId: string;
  prompt: string;
};

function writeEvent(evt: unknown) {
  process.stdout.write(JSON.stringify(evt) + "\n");
}

async function main() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  const lines: string[] = [];
  for await (const line of rl) lines.push(line);

  const raw = lines.join("\n").trim();
  if (!raw) {
    writeEvent({
      v: 0,
      type: "final",
      result: { status: "error", error: { message: "Missing input payload" } },
    });
    process.exit(2);
    return;
  }

  let input: Input;
  try {
    input = JSON.parse(raw) as Input;
  } catch {
    writeEvent({
      v: 0,
      type: "final",
      result: { status: "error", error: { message: "Invalid JSON payload" } },
    });
    process.exit(2);
    return;
  }

  if (input.v !== 0 || typeof input.prompt !== "string") {
    writeEvent({
      v: 0,
      type: "final",
      result: { status: "error", error: { message: "Unsupported payload" } },
    });
    process.exit(2);
    return;
  }

  writeEvent({
    v: 0,
    type: "agent_event",
    event: { kind: "trace", message: `echo-cli received attemptId=${input.attemptId}` },
  });

  const text = `Echo runtime says:\n\n${input.prompt}\n`;
  for (const chunk of chunkString(text, 48)) {
    writeEvent({ v: 0, type: "partial_reply", text: chunk });
    await sleep(10);
  }

  writeEvent({
    v: 0,
    type: "final",
    result: { status: "ok", text, native: { threadId: null } },
  });
}

function chunkString(str: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  writeEvent({
    v: 0,
    type: "final",
    result: { status: "error", error: { message: err?.message ?? String(err) } },
  });
  process.exit(1);
});

