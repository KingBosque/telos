import type { HarnessAttemptPayload, HarnessEvent } from "../serde/attemptPayload.js";

export type NativeRuntimeResult =
  | { status: "ok"; finalText?: string; native?: Record<string, unknown> }
  | { status: "error"; message: string };

export type NativeRuntime = {
  runAttempt: (args: {
    payload: HarnessAttemptPayload;
    onEvent: (event: HarnessEvent) => void;
  }) => Promise<NativeRuntimeResult>;
};

