import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { HarnessEvent } from "../serde/attemptPayload.js";
import { parseNdjsonLine } from "../serde/attemptPayload.js";
import type { DaemonClient, DaemonSessionBinding, DaemonStartOptions } from "./types.js";
import { loadPolicy } from "../policy/loadPolicy.js";

type AttemptEnvelope = {
  v: 0;
  type: "attempt";
  payload: unknown;
  binding: DaemonSessionBinding | null;
};

type ResetEnvelope = { v: 0; type: "reset"; openclawSessionId: string; nativeThreadId?: string };

type ToolResultEnvelope = { v: 0; type: "tool_result"; callId: string; result: unknown };
type QuarantineEnvelope = {
  v: 0;
  type: "quarantine";
  scope: string;
  reason: string;
  openclawSessionId?: string;
  unknownType?: string;
  summary?: unknown;
};

export function createPersistentDaemonClient(opts: DaemonStartOptions): DaemonClient {
  const child = spawn(opts.command, opts.args, {
    env: { ...process.env, ...(opts.env ?? {}) },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const stdoutRl = createInterface({ input: child.stdout });

  let active: {
    resolve: (v: { finalText?: string; native?: Record<string, unknown>; binding?: DaemonSessionBinding }) => void;
    reject: (err: Error) => void;
    onEvent: (evt: HarnessEvent) => void;
    onToolCall?: (toolCall: Extract<HarnessEvent, { type: "tool_call" }>) => Promise<unknown>;
    payloadOpenclawSessionId?: string;
    nextBinding?: DaemonSessionBinding;
    streamed: string;
  } | null = null;

  const send = (msg: unknown) => {
    child.stdin.write(JSON.stringify(msg) + "\n");
  };

  stdoutRl.on("line", async (line) => {
    const parsed = parseNdjsonLine(line);
    if (!parsed || !active) return;
    if (parsed.kind === "unknown") {
      const policy = loadPolicy({
        scope: { openclawSessionId: active.payloadOpenclawSessionId, nativeThreadId: active.nextBinding?.nativeThreadId },
      });

      if (parsed.unknownType && policy.policy.protocol.knownEventTypes.includes(parsed.unknownType)) {
        active.onEvent({
          v: 0,
          type: "agent_event",
          event: {
            kind: "protocol_violation",
            scope: "persistent_daemon_stdout",
            reason: "policy_allowed_extension",
            unknownType: parsed.unknownType,
            summary: parsed.summary,
          },
        });
        return;
      }

      // Quarantine the daemon session (persistent mode) on protocol novelty.
      send({
        v: 0,
        type: "quarantine",
        scope: "persistent_daemon_stdout",
        reason: policy.policy.protocol.strictness === "strict" ? "strict_protocol_unknown" : parsed.reason,
        openclawSessionId: active.payloadOpenclawSessionId,
        unknownType: parsed.unknownType,
        summary: parsed.summary,
      } satisfies QuarantineEnvelope);

      active.onEvent({
        v: 0,
        type: "agent_event",
        event: {
          kind: "protocol_violation",
          scope: "persistent_daemon_stdout",
          reason: policy.policy.protocol.strictness === "strict" ? "strict_protocol_unknown" : parsed.reason,
          unknownType: parsed.unknownType,
          summary: parsed.summary,
        },
      });
      return;
    }
    const evt: HarnessEvent = parsed.event;

    if (evt.type === "partial_reply") active.streamed += evt.text;

    if (evt.type === "tool_call" && active.onToolCall) {
      try {
        const result = await active.onToolCall(evt);
        send({ v: 0, type: "tool_result", callId: evt.callId, result } satisfies ToolResultEnvelope);
      } catch (err: any) {
        send({
          v: 0,
          type: "tool_result",
          callId: evt.callId,
          result: { error: { message: err?.message ?? String(err) } },
        } satisfies ToolResultEnvelope);
      }
      return;
    }

    active.onEvent(evt);

    if (evt.type === "final") {
      if (evt.result.status === "ok") {
        const finalText = evt.result.text;
        const native = evt.result.native;
        const embeddedBinding = (native as any)?.binding;
        const openclawSessionId =
          active.payloadOpenclawSessionId ??
          (typeof embeddedBinding?.openclawSessionId === "string" ? embeddedBinding.openclawSessionId : undefined);
        const nativeThreadId =
          (typeof embeddedBinding?.nativeThreadId === "string" ? embeddedBinding.nativeThreadId : undefined) ??
          (typeof (native as any)?.threadId === "string" ? (native as any).threadId : undefined);
        const binding = openclawSessionId && nativeThreadId ? { openclawSessionId, nativeThreadId } : undefined;

        const resolve = active.resolve;
        active = null;
        resolve({ finalText: finalText ?? undefined, native: native ?? {}, binding });
      } else {
        const reject = active.reject;
        active = null;
        reject(new Error(evt.result.error.message));
      }
    }
  });

  child.on("close", (code) => {
    if (active) {
      const reject = active.reject;
      active = null;
      reject(new Error(`Persistent daemon exited code=${code}${stderr.trim() ? ` stderr=${stderr.trim()}` : ""}`));
    }
  });

  return {
    async runAttempt({ payload, binding, onEvent, onToolCall }) {
      if (active) throw new Error("Daemon is busy (only one in-flight attempt is supported)");

      const payloadOpenclawSessionId = (payload as any)?.session?.openclawSessionId as string | undefined;

      const p = new Promise<{ status: "ok"; finalText?: string; native?: Record<string, unknown>; binding?: DaemonSessionBinding }>(
        (resolve, reject) => {
          active = {
            resolve: (v) => resolve({ status: "ok", finalText: v.finalText, native: v.native, binding: v.binding }),
            reject,
            onEvent,
            onToolCall,
            payloadOpenclawSessionId,
            nextBinding: binding,
            streamed: "",
          };
        },
      );

      send({ v: 0, type: "attempt", payload, binding: binding ?? null } satisfies AttemptEnvelope);
      return await p;
    },

    async resetSession({ openclawSessionId, binding }) {
      if (active) throw new Error("Cannot reset session while an attempt is running");
      send({ v: 0, type: "reset", openclawSessionId, nativeThreadId: binding?.nativeThreadId } satisfies ResetEnvelope);
    },
  };
}

