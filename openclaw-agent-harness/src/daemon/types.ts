import type { HarnessAttemptPayload, HarnessEvent } from "../serde/attemptPayload.js";

export type DaemonStartOptions = {
  /**
   * Path or command that starts the daemon.
   * In early phases we run a node script in-process style via spawn.
   */
  command: string;
  args: string[];
  env?: Record<string, string | undefined>;
};

export type DaemonSessionBinding = {
  openclawSessionId: string;
  nativeThreadId: string;
};

export type DaemonClient = {
  runAttempt: (args: {
    payload: HarnessAttemptPayload;
    binding?: DaemonSessionBinding;
    onEvent: (event: HarnessEvent) => void;
    onToolCall?: (toolCall: Extract<HarnessEvent, { type: "tool_call" }>) => Promise<unknown>;
  }) => Promise<{
    status: "ok";
    finalText?: string;
    native?: Record<string, unknown>;
    binding?: DaemonSessionBinding;
  }>;

  resetSession: (args: { openclawSessionId: string; binding?: DaemonSessionBinding }) => Promise<void>;
};

