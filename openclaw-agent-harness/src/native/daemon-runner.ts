import { createInterface } from "node:readline";

type AttemptEnvelope = {
  v: 0;
  type: "attempt";
  payload: { v: 0; attemptId: string; prompt: string };
  binding: { openclawSessionId: string; nativeThreadId: string } | null;
};

type ToolResult = {
  v: 0;
  type: "tool_result";
  callId: string;
  result: unknown;
};

function writeEvent(evt: unknown) {
  process.stdout.write(JSON.stringify(evt) + "\n");
}

async function main() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  let attempt: AttemptEnvelope | null = null;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const msg = JSON.parse(trimmed) as any;

    if (msg?.type === "attempt") {
      attempt = msg as AttemptEnvelope;
      break;
    }
  }

  if (!attempt) {
    writeEvent({
      v: 0,
      type: "final",
      result: { status: "error", error: { message: "Missing attempt envelope" } },
    });
    process.exit(2);
    return;
  }

  const openclawSessionId = attempt.binding?.openclawSessionId ?? "unknown-session";
  const nativeThreadId = attempt.binding?.nativeThreadId ?? `thread-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;

  writeEvent({
    v: 0,
    type: "heartbeat",
    ts: Date.now(),
    status: "ok",
  });

  writeEvent({
    v: 0,
    type: "handshake",
    daemon: { version: "0.0.1", protocolVersion: 0 },
    health: { status: "ok", ts: Date.now() },
  });

  writeEvent({
    v: 0,
    type: "agent_event",
    event: {
      kind: "trace",
      message: `daemon-runner started (attemptId=${attempt.payload.attemptId}, sessionId=${openclawSessionId}, threadId=${nativeThreadId})`,
    },
  });

  // Kitchen-sink demo: request a pretend tool call and wait for tool_result.
  const callId = `call-${Date.now().toString(16)}`;
  writeEvent({
    v: 0,
    type: "tool_call",
    callId,
    name: "echo_tool",
    arguments: { prompt: attempt.payload.prompt },
  });

  const toolResult = await waitForToolResult(rl, callId, 5000);
  writeEvent({
    v: 0,
    type: "agent_event",
    event: { kind: "trace", message: `received tool_result for ${callId}` },
  });

  const text = `Daemon runner says:\n\n${attempt.payload.prompt}\n\nToolResult:\n${JSON.stringify(toolResult, null, 2)}\n`;
  for (const chunk of chunkString(text, 48)) {
    writeEvent({ v: 0, type: "partial_reply", text: chunk });
    await sleep(10);
  }

  writeEvent({
    v: 0,
    type: "final",
    result: {
      status: "ok",
      text,
      native: {
        threadId: nativeThreadId,
        binding: { openclawSessionId, nativeThreadId },
      },
    },
  });
}

async function waitForToolResult(rl: ReturnType<typeof createInterface>, callId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;

  for await (const line of rl) {
    if (Date.now() > deadline) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    const msg = JSON.parse(trimmed) as any;
    if (msg?.type === "tool_result" && msg?.callId === callId) {
      return (msg as ToolResult).result;
    }
  }

  return { error: { message: "Timed out waiting for tool_result" } };
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

