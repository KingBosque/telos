import { createInterface } from "node:readline";
import { readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:http";
import { createTriggerEngine, type TriggerEngineState } from "../triggers/triggerEngine.js";
import { computeBackoffMs, defaultModeConfig, initModeState, noteCleanTurn, reduceModeState } from "../safety/modeMachine.js";
import { createAuditLedger } from "../audit/auditLedger.js";
import { writeProposal } from "../evolution/proposalWriter.js";
import { loadPolicy } from "../policy/loadPolicy.js";

type AttemptEnvelope = {
  v: 0;
  type: "attempt";
  payload: { v: 0; attemptId: string; prompt: string };
  binding: { openclawSessionId: string; nativeThreadId: string } | null;
};

type ResetEnvelope = {
  v: 0;
  type: "reset";
  openclawSessionId: string;
  nativeThreadId?: string;
};

type ToolResult = { v: 0; type: "tool_result"; callId: string; result: unknown };

type QuarantineEnvelope = {
  v: 0;
  type: "quarantine";
  scope: string;
  reason: string;
  openclawSessionId?: string;
  unknownType?: string;
  summary?: unknown;
};

type Inbound = AttemptEnvelope | ResetEnvelope | ToolResult | QuarantineEnvelope;

type PendingToolResult = { callId: string; resolve: (v: unknown) => void };

function writeEvent(evt: unknown) {
  process.stdout.write(JSON.stringify(evt) + "\n");
}

function safeParse(line: string): Inbound | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Inbound;
  } catch {
    return null;
  }
}

type SessionState = {
  openclawSessionId: string;
  nativeThreadId: string;
};

function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function isPaused(): boolean {
  const flag = process.env.ARCANE_PAUSE_FILE ?? join(process.cwd(), "runs", "paused");
  try {
    readFileSync(flag, "utf8");
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  const sessions = new Map<string, SessionState>();
  let pendingToolResult: PendingToolResult | null = null;

  const audit = createAuditLedger();
  const modeConfig = defaultModeConfig();
  let modeState = initModeState();
  let backoffUntilTs = 0;
  const policy = loadPolicy();
  const tension = { enabled: true, maxOpenLoopsBeforeStabilize: 3, maxRecentFailuresBeforeStabilize: 3 };
  const triggerEngine = createTriggerEngine({
    schedule: { enabled: true, hourly: true, daily: false },
    tension,
  });
  const triggerState: TriggerEngineState = { openLoops: 0, recentFailures: 0 };
  const inboxDir = join(process.cwd(), "runs", "inbox");

  const capabilityProfileForMode = (mode: keyof typeof modeConfig.profiles) => {
    if (mode !== "safe_mode" || policy.derived.safeModeAllowlistAdd.length === 0) return modeConfig.profiles[mode];
    return {
      ...modeConfig.profiles.safe_mode,
      toolAllowlist: [...modeConfig.profiles.safe_mode.toolAllowlist, ...policy.derived.safeModeAllowlistAdd],
    };
  };

  writeEvent({ v: 0, type: "heartbeat", ts: Date.now(), status: "ok" });
  writeEvent({
    v: 0,
    type: "handshake",
    daemon: { version: "0.0.1", protocolVersion: 0 },
    health: { status: "ok", ts: Date.now() },
  });
  writeEvent({ v: 0, type: "agent_event", event: { kind: "trace", message: "persistent-daemon started" } });

  const setBackoff = (reason: string) => {
    const profile = capabilityProfileForMode(modeState.mode);
    const ms = computeBackoffMs({ profile, state: modeState });
    backoffUntilTs = Date.now() + ms;
    writeEvent({
      v: 0,
      type: "agent_event",
      event: {
        kind: "backoff",
        reason,
        mode: modeState.mode,
        ms,
        untilTs: backoffUntilTs,
        riskScore: modeState.riskScore,
        toolFailures: modeState.toolFailureCount,
        triggerState,
      },
    });
  };

  const decayTimer = setInterval(() => {
    // Let tension recover over time if the system is quiet.
    triggerState.openLoops = Math.max(0, triggerState.openLoops - 1);
    triggerState.recentFailures = Math.max(0, triggerState.recentFailures - 1);
  }, 60_000);
  decayTimer.unref();

  const webhookPort = Number(process.env.ARCANE_WEBHOOK_PORT ?? "");
  if (Number.isFinite(webhookPort) && webhookPort > 0) {
    const server = createServer((req, res) => {
      if (req.method !== "POST" || (req.url ?? "") !== "/event") {
        res.statusCode = 404;
        res.end("not_found");
        return;
      }

      let body = "";
      req.setEncoding("utf8");
      req.on("data", (c) => (body += String(c)));
      req.on("end", () => {
        let payload: any;
        try {
          payload = JSON.parse(body);
        } catch {
          payload = { error: "invalid_json" };
        }

        const kind = typeof payload?.kind === "string" ? String(payload.kind) : "webhook_event";
        const triggers = triggerEngine.ingestEvent({
          mode: modeState.mode,
          capabilityProfile: capabilityProfileForMode(modeState.mode),
          event: { kind, payload: isRecord(payload) ? payload : { payload } },
        });

        for (const t of triggers) {
          triggerState.openLoops += 1;
          writeEvent({
          v: 0,
          type: "agent_event",
          event: { ...t, kind: "trigger" as const, triggerId: t.id },
        });
          audit.append({
            openclawSessionId: "trigger-daemon",
            attemptId: `trigger-${t.id}`,
            mode: modeState.mode,
            trigger: { source: t.source, id: t.id },
            intent: t.intent,
            expectedSideEffects: t.expectedSideEffects,
            notes: { triggerId: t.id, webhookKind: kind },
          });
        }

        // If tension is high, slow down new ingress immediately.
        if (tension.enabled && (triggerState.openLoops >= tension.maxOpenLoopsBeforeStabilize || triggerState.recentFailures >= tension.maxRecentFailuresBeforeStabilize)) {
          modeState = reduceModeState({
            config: modeConfig,
            state: modeState,
            signal: { kind: "loop_detected", fingerprint: "trigger_ingress_pressure", count: triggerState.openLoops },
          });
          setBackoff("trigger_ingress_pressure");
        }

        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true, triggers: triggers.map((t) => ({ id: t.id, source: t.source })) }));
      });
    });

    server.listen(webhookPort, "127.0.0.1", () => {
      writeEvent({
        v: 0,
        type: "agent_event",
        event: { kind: "trace", message: `webhook listening on http://127.0.0.1:${webhookPort}/event` },
      });
    });
  }

  const inboxTimer = setInterval(() => {
    if (isPaused()) return;
    if (backoffUntilTs && Date.now() < backoffUntilTs) return;
    tryIngestInboxEvents({
      inboxDir,
      onEvent: (evt) => {
        // Emit as agent events; in a real integration, these become OpenClaw attempts via core.
        writeEvent({ v: 0, type: "agent_event", event: { ...evt, kind: "trigger" as const, triggerId: evt.triggerId } });
      },
      capabilityProfile: capabilityProfileForMode(modeState.mode),
      mode: modeState.mode,
      triggerEngine,
      state: triggerState,
      audit: (rec) => audit.append(rec),
    });

    if (tension.enabled && (triggerState.openLoops >= tension.maxOpenLoopsBeforeStabilize || triggerState.recentFailures >= tension.maxRecentFailuresBeforeStabilize)) {
      modeState = reduceModeState({
        config: modeConfig,
        state: modeState,
        signal: { kind: "loop_detected", fingerprint: "inbox_pressure", count: triggerState.openLoops },
      });
      setBackoff("inbox_pressure");
    }
  }, 2000);
  inboxTimer.unref();

  const scheduleTimer = setInterval(() => {
    if (isPaused()) return;
    if (backoffUntilTs && Date.now() < backoffUntilTs) return;
    const triggers = triggerEngine.tick({
      mode: modeState.mode,
      capabilityProfile: capabilityProfileForMode(modeState.mode),
      state: triggerState,
    });
    for (const t of triggers) {
      triggerState.openLoops += 1;
      writeEvent({ v: 0, type: "agent_event", event: { ...t, kind: "trigger" as const, triggerId: t.id } });
      writeEvent({
        v: 0,
        type: "agent_event",
        event: { kind: "mode", mode: modeState.mode, riskScore: modeState.riskScore, toolFailures: modeState.toolFailureCount },
      });
      audit.append({
        openclawSessionId: "trigger-daemon",
        attemptId: `trigger-${t.id}`,
        mode: modeState.mode,
        trigger: { source: t.source, id: t.id },
        intent: t.intent,
        expectedSideEffects: t.expectedSideEffects,
        notes: { triggerId: t.id, untrustedContextKeys: Object.keys(t.untrustedContext ?? {}) },
      });
    }

    if (tension.enabled && (triggerState.openLoops >= tension.maxOpenLoopsBeforeStabilize || triggerState.recentFailures >= tension.maxRecentFailuresBeforeStabilize)) {
      modeState = reduceModeState({
        config: modeConfig,
        state: modeState,
        signal: { kind: "loop_detected", fingerprint: "schedule_pressure", count: triggerState.openLoops },
      });
      setBackoff("schedule_pressure");
    }
  }, 60_000);
  scheduleTimer.unref();

  for await (const line of rl) {
    const msg = safeParse(line);
    if (!msg) continue;

    // Unknown inbound types are quarantined (not dropped).
    if ((msg as any).v === 0 && typeof (msg as any).type === "string") {
      const inboundType = String((msg as any).type);
      const isKnownInbound = inboundType === "attempt" || inboundType === "reset" || inboundType === "tool_result" || inboundType === "quarantine";
      if (!isKnownInbound) {
        modeState = reduceModeState({
          config: modeConfig,
          state: modeState,
          signal: { kind: "protocol_unknown", scope: "persistent_daemon_stdin", reason: `unknown_inbound_type:${inboundType}` },
        });
        setBackoff("protocol_unknown_inbound");
        writeProposal({
          kind: "protocol_unknown",
          scope: "persistent_daemon_stdin",
          reason: "unknown_inbound_type",
          unknownType: inboundType,
          summary: { inboundType },
        });
        writeEvent({
          v: 0,
          type: "agent_event",
          event: {
            kind: "protocol_violation",
            scope: "persistent_daemon_stdin",
            reason: "unknown_inbound_type",
            unknownType: inboundType,
          },
        });
        writeEvent({
          v: 0,
          type: "agent_event",
          event: { kind: "mode", mode: modeState.mode, riskScore: modeState.riskScore, toolFailures: modeState.toolFailureCount },
        });
        continue;
      }
    }

    if (msg.type === "tool_result") {
      const tr = msg as ToolResult;
      const pending: PendingToolResult | null = pendingToolResult;
      if (pending && tr.callId === pending.callId) {
        pendingToolResult = null;
        pending.resolve(tr.result);
      }
      continue;
    }

    if (msg.type === "quarantine") {
      modeState = reduceModeState({
        config: modeConfig,
        state: modeState,
        signal: { kind: "protocol_unknown", scope: msg.scope, reason: msg.reason },
      });
      setBackoff("quarantine");
      writeProposal({
        kind: "protocol_violation",
        scope: msg.scope,
        reason: msg.reason,
        unknownType: msg.unknownType,
        summary: msg.summary,
      });
      writeEvent({
        v: 0,
        type: "agent_event",
        event: {
          kind: "quarantine",
          scope: msg.scope,
          reason: msg.reason,
          unknownType: msg.unknownType,
          summary: msg.summary,
          mode: modeState.mode,
          riskScore: modeState.riskScore,
        },
      });
      writeEvent({
        v: 0,
        type: "agent_event",
        event: { kind: "mode", mode: modeState.mode, riskScore: modeState.riskScore, toolFailures: modeState.toolFailureCount },
      });
      continue;
    }

    if (msg.type === "reset") {
      sessions.delete(msg.openclawSessionId);
      writeEvent({
        v: 0,
        type: "agent_event",
        event: { kind: "trace", message: `reset session=${msg.openclawSessionId}` },
      });
      continue;
    }

    if (msg.type !== "attempt") continue;

    const attempt = msg;
    const openclawSessionId = attempt.binding?.openclawSessionId ?? "unknown-session";

    let state = sessions.get(openclawSessionId);
    if (!state) {
      const nativeThreadId =
        attempt.binding?.nativeThreadId ??
        `thread-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
      state = { openclawSessionId, nativeThreadId };
      sessions.set(openclawSessionId, state);
    }

    writeEvent({
      v: 0,
      type: "agent_event",
      event: {
        kind: "trace",
        message: `attempt start attemptId=${attempt.payload.attemptId} sessionId=${state.openclawSessionId} threadId=${state.nativeThreadId}`,
      },
    });

    // Demo: request a tool call each attempt and wait for tool_result.
    const callId = `call-${Date.now().toString(16)}`;
    writeEvent({
      v: 0,
      type: "tool_call",
      callId,
      name: "echo_tool",
      arguments: { prompt: attempt.payload.prompt },
      reason: "demo: echo prompt back for traceability",
      expectedSideEffects: ["reads attempt prompt", "returns summary"],
      dataProvenance: "cached_state",
    });

    let toolResult: unknown;
    try {
      toolResult = await withTimeout(
        new Promise<unknown>((resolve) => {
          pendingToolResult = { callId, resolve };
        }),
        15_000,
      );

      const isError = isRecord(toolResult) && isRecord((toolResult as any).error);
      if (isError) {
        triggerState.recentFailures += 1;
        modeState = reduceModeState({
          config: modeConfig,
          state: modeState,
          signal: { kind: "tool_failure", toolName: "echo_tool", count: triggerState.recentFailures },
        });
        setBackoff("tool_result_error");
      } else {
        modeState = noteCleanTurn(modeState, modeConfig);
        triggerState.openLoops = Math.max(0, triggerState.openLoops - 1);
      }
    } catch (err: any) {
      triggerState.recentFailures += 1;
      modeState = reduceModeState({
        config: modeConfig,
        state: modeState,
        signal: { kind: "tool_failure", toolName: "echo_tool", count: triggerState.recentFailures },
      });
      setBackoff("tool_result_timeout_or_exception");
      toolResult = { error: { message: err?.message ?? String(err) } };
    }

    writeEvent({
      v: 0,
      type: "budget",
      remaining: {
        turnsPerHour: modeConfig.profiles[modeState.mode].budgets.maxTurnsPerHour,
        toolCallsThisTurn: modeConfig.profiles[modeState.mode].budgets.maxToolCallsPerTurn - 1,
        wallClockMsThisTurn: modeConfig.profiles[modeState.mode].budgets.maxWallClockMsPerTurn,
      },
    });

    const text = `Persistent daemon says:\n\n${attempt.payload.prompt}\n\nToolResult:\n${JSON.stringify(toolResult, null, 2)}\n`;
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
        native: { threadId: state.nativeThreadId, binding: state },
      },
    });
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timeout: NodeJS.Timeout | undefined;
  const timer = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timer]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function tryIngestInboxEvents(args: {
  inboxDir: string;
  onEvent: (evt: { source: "inbox"; triggerId: string; kind: string; payload: unknown }) => void;
  capabilityProfile: any;
  mode: any;
  triggerEngine: ReturnType<typeof createTriggerEngine>;
  state: TriggerEngineState;
  audit: (rec: Parameters<ReturnType<typeof createAuditLedger>["append"]>[0]) => void;
}) {
  let entries: string[];
  try {
    entries = readdirSync(args.inboxDir);
  } catch {
    return;
  }

  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    const full = join(args.inboxDir, name);
    let payload: unknown;
    try {
      payload = JSON.parse(readFileSync(full, "utf8"));
    } catch {
      payload = { error: "invalid_json" };
    }

    const kind = typeof (payload as any)?.kind === "string" ? String((payload as any).kind) : "inbox_event";
    const triggers = args.triggerEngine.ingestEvent({
      mode: args.mode,
      capabilityProfile: args.capabilityProfile,
      event: { kind, payload: (payload as any) ?? {} },
    });

    for (const t of triggers) {
      args.state.openLoops += 1;
      args.onEvent({ source: "inbox", triggerId: t.id, kind, payload });
      args.audit({
        openclawSessionId: "trigger-daemon",
        attemptId: `trigger-${t.id}`,
        mode: args.mode,
        trigger: { source: t.source, id: t.id },
        intent: t.intent,
        expectedSideEffects: t.expectedSideEffects,
        notes: { triggerId: t.id, inboxFile: name },
      });
    }

    try {
      unlinkSync(full);
    } catch {
      // ignore
    }
  }
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
  writeEvent({ v: 0, type: "final", result: { status: "error", error: { message: err?.message ?? String(err) } } });
  process.exit(1);
});

