export type CoreToolCall = { callId: string; name: string; arguments: unknown };

export type CoreToolExecution = {
  ok: boolean;
  approved?: boolean;
  result?: unknown;
  error?: { message: string; code?: string };
};

/**
 * OpenClaw SDK types are not vendored in this starter repo (peer dep).
 * So we duck-type the minimal host capabilities we need.
 */
export function executeToolViaOpenClawCore(args: {
  params: unknown;
  toolCall: CoreToolCall;
  timeoutMs: number;
}): Promise<CoreToolExecution> {
  const { params, toolCall, timeoutMs } = args;

  const p = params as any;

  // Preferred: a single method that accepts {name, arguments} and returns output.
  const exec1 = p?.executeTool as undefined | ((tool: { name: string; arguments: unknown }) => Promise<unknown>);
  if (exec1) {
    return withTimeout(
      exec1({ name: toolCall.name, arguments: toolCall.arguments }).then((result) => ({
        ok: true,
        approved: "unknown",
        result,
      })),
      timeoutMs,
    );
  }

  // Alternate: call by name.
  const exec2 =
    p?.executeToolByName as undefined | ((name: string, args: unknown) => Promise<{ approved?: boolean; result?: unknown } | unknown>);
  if (exec2) {
    return withTimeout(
      exec2(toolCall.name, toolCall.arguments).then((out) => ({
        ok: true,
        approved: (out as any)?.approved ?? "unknown",
        result: (out as any)?.result ?? out,
      })),
      timeoutMs,
    );
  }

  // Fallback: if the host exposes a general tool runner, accept that.
  const runTool = p?.runTool as undefined | ((name: string, args: unknown) => Promise<unknown>);
  if (runTool) {
    return withTimeout(
      runTool(toolCall.name, toolCall.arguments).then((result) => ({ ok: true, approved: "unknown", result })),
      timeoutMs,
    );
  }

  return Promise.resolve({
    ok: false,
    error: {
      code: "missing_core_tool_executor",
      message:
        "Host did not provide a tool execution adapter. Expected params.executeTool(...) or executeToolByName(...) or runTool(...).",
    },
  });
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

  let timeout: NodeJS.Timeout | undefined;
  const timer = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timer]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

