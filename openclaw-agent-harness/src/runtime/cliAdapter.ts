import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { NativeRuntime, NativeRuntimeResult } from "./types.js";
import type { HarnessAttemptPayload, HarnessEvent } from "../serde/attemptPayload.js";
import { parseNdjsonLine } from "../serde/attemptPayload.js";

export type CliAdapterOptions = {
  command: string;
  args: string[];
  env?: Record<string, string | undefined>;
};

export function createCliRuntimeAdapter(opts: CliAdapterOptions): NativeRuntime {
  return {
    async runAttempt({ payload, onEvent }): Promise<NativeRuntimeResult> {
      const child = spawn(opts.command, opts.args, {
        env: { ...process.env, ...(opts.env ?? {}) },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let sawFinal = false;
      let finalResult: NativeRuntimeResult | null = null;
      let stderr = "";

      const stdoutRl = createInterface({ input: child.stdout });
      stdoutRl.on("line", (line) => {
        const parsed = parseNdjsonLine(line);
        if (!parsed) return;
        if (parsed.kind === "unknown") {
          onEvent({
            v: 0,
            type: "agent_event",
            event: {
              kind: "protocol_violation",
              scope: "cli_stdout",
              reason: parsed.reason,
              unknownType: parsed.unknownType,
              summary: parsed.summary,
            },
          });
          return;
        }

        const evt: HarnessEvent = parsed.event;
        onEvent(evt);
        if (evt.type === "final") {
          sawFinal = true;
          if (evt.result.status === "ok") {
            finalResult = {
              status: "ok",
              finalText: evt.result.text,
              native: evt.result.native,
            };
          } else {
            finalResult = {
              status: "error",
              message: evt.result.error.message,
            };
          }
        }
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.stdin.write(JSON.stringify(payload) + "\n");
      child.stdin.end();

      const exitCode: number = await new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", resolve);
      });

      stdoutRl.close();

      if (finalResult) return finalResult;

      if (exitCode !== 0) {
        return {
          status: "error",
          message:
            (sawFinal ? "" : "Native runtime exited without final event. ") +
            `exitCode=${exitCode}` +
            (stderr.trim() ? ` stderr=${stderr.trim()}` : ""),
        };
      }

      return {
        status: "error",
        message: "Native runtime ended without a final event.",
      };
    },
  };
}

export function buildEchoCliPayload(args: {
  attemptId: string;
  prompt: string;
  tools?: HarnessAttemptPayload["tools"];
}): HarnessAttemptPayload {
  return {
    v: 0,
    attemptId: args.attemptId,
    prompt: args.prompt,
    tools: args.tools ?? [],
    images: [],
  };
}

