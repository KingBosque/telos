import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { HarnessAttemptPayload, HarnessEvent } from "../serde/attemptPayload.js";
import { parseNdjsonLine } from "../serde/attemptPayload.js";
import type { DaemonClient, DaemonSessionBinding, DaemonStartOptions } from "./types.js";

/**
 * Phase-1+ daemon client: spawn a per-attempt daemon runner.
 * The seam is here: later, replace with a long-running daemon transport.
 */
export function createSpawnedDaemonClient(opts: DaemonStartOptions): DaemonClient {
  return {
    async runAttempt({ payload, binding, onEvent, onToolCall }) {
      const child = spawn(opts.command, opts.args, {
        env: { ...process.env, ...(opts.env ?? {}) },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let streamed = "";
      let stderr = "";
      let finalText: string | undefined;
      let native: Record<string, unknown> | undefined;
      let nextBinding: DaemonSessionBinding | undefined = binding;

      const stdoutRl = createInterface({ input: child.stdout });
      const sendToDaemon = (evt: unknown) => {
        child.stdin.write(JSON.stringify(evt) + "\n");
      };

      // initial hello: include binding if present
      sendToDaemon({
        v: 0,
        type: "attempt",
        payload,
        binding: binding ?? null,
      });

      stdoutRl.on("line", async (line) => {
        const parsed = parseNdjsonLine(line);
        if (!parsed) return;
        if (parsed.kind === "unknown") {
          onEvent({
            v: 0,
            type: "agent_event",
            event: {
              kind: "protocol_violation",
              scope: "daemon_stdout",
              reason: parsed.reason,
              unknownType: parsed.unknownType,
              summary: parsed.summary,
            },
          });
          return;
        }
        const evt: HarnessEvent = parsed.event;

        if (evt.type === "partial_reply") streamed += evt.text;

        if (evt.type === "tool_call" && onToolCall) {
          try {
            const result = await onToolCall(evt);
            sendToDaemon({ v: 0, type: "tool_result", callId: evt.callId, result });
          } catch (err: any) {
            sendToDaemon({
              v: 0,
              type: "tool_result",
              callId: evt.callId,
              result: { error: { message: err?.message ?? String(err) } },
            });
          }
          return;
        }

        onEvent(evt);

        if (evt.type === "final") {
          if (evt.result.status === "ok") {
            finalText = evt.result.text;
            native = evt.result.native;
            const embeddedBinding = (evt.result.native as any)?.binding;
            const openclawSessionId =
              payload.session?.openclawSessionId ??
              (typeof embeddedBinding?.openclawSessionId === "string" ? embeddedBinding.openclawSessionId : undefined);
            const nativeThreadId =
              (typeof embeddedBinding?.nativeThreadId === "string" ? embeddedBinding.nativeThreadId : undefined) ??
              (typeof (evt.result.native as any)?.threadId === "string" ? (evt.result.native as any).threadId : undefined);
            if (openclawSessionId && nativeThreadId) {
              nextBinding = { openclawSessionId, nativeThreadId };
            }
          } else {
            // surface failure via nonzero exit path; also allow final event error to bubble
          }
        }
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      // close stdin after initial attempt message; tool_result can still be written
      // because stdin remains open until child exits. Keep it open.

      const exitCode: number = await new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", resolve);
      });

      stdoutRl.close();

      if (exitCode !== 0) {
        throw new Error(`Daemon attempt failed exitCode=${exitCode}${stderr.trim() ? ` stderr=${stderr.trim()}` : ""}`);
      }

      return {
        status: "ok",
        finalText: finalText ?? streamed,
        native: native ?? {},
        binding: nextBinding,
      };
    },

    async resetSession({ openclawSessionId }) {
      // In spawned mode, reset is a no-op because there is no persistent daemon state.
      void openclawSessionId;
    },
  };
}

