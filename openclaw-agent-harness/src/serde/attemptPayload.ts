export type HarnessProtocolVersion = 0;

export type ToolDataProvenance = "user_intent" | "untrusted_context" | "model_inference" | "cached_state" | "unknown";

export type TriggerSource = "schedule" | "event" | "tension" | "interactive" | "unknown";

export type HarnessAttemptPayload = {
  v: HarnessProtocolVersion;
  attemptId: string;
  prompt: string;
  /**
   * Optional structured intent boundary (preferred over prompt-only).
   * The daemon may still render/compose its own final model prompt.
   */
  intent?: string;
  untrustedContext?: Record<string, unknown>;
  expectedSideEffects?: string[];
  capabilityProfile?: Record<string, unknown>;
  trigger?: { source: TriggerSource; id?: string };
  model?: string;
  provider?: string;
  tools: Array<{
    name: string;
    description?: string;
    schema?: unknown;
  }>;
  images: Array<unknown>;
  session?: {
    openclawSessionId?: string;
    transcriptPath?: string;
  };
  policy?: Record<string, unknown>;
};

export type HarnessEvent =
  | { v: HarnessProtocolVersion; type: "partial_reply"; text: string }
  | { v: HarnessProtocolVersion; type: "agent_event"; event: unknown }
  | {
      v: HarnessProtocolVersion;
      type: "handshake";
      daemon: { version: string; protocolVersion: HarnessProtocolVersion };
      health: { status: "ok" | "degraded"; ts: number };
    }
  | {
      v: HarnessProtocolVersion;
      type: "tool_call";
      callId: string;
      name: string;
      arguments: unknown;
      reason?: string;
      expectedSideEffects?: string[];
      dataProvenance?: ToolDataProvenance;
    }
  | {
      v: HarnessProtocolVersion;
      type: "tool_result";
      callId: string;
      result: unknown;
      approved?: boolean;
      policyBasis?: { reason: string; details?: Record<string, unknown> };
    }
  | {
      v: HarnessProtocolVersion;
      type: "budget";
      remaining: {
        turnsPerHour?: number;
        toolCallsThisTurn?: number;
        wallClockMsThisTurn?: number;
      };
    }
  | {
      v: HarnessProtocolVersion;
      type: "heartbeat";
      ts: number;
      status?: "ok" | "degraded";
    }
  | {
      v: HarnessProtocolVersion;
      type: "final";
      result:
        | { status: "ok"; text?: string; native?: Record<string, unknown> }
        | { status: "error"; error: { message: string } };
    };

export type ParsedNdjsonLine =
  | { kind: "event"; event: HarnessEvent }
  | {
      kind: "unknown";
      reason: string;
      unknownType?: string;
      summary: unknown;
    };

function summarizeUnknownValue(value: unknown, depth = 2): unknown {
  if (depth <= 0) return { type: typeof value };
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) return { type: "array", length: value.length };
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o).slice(0, 50);
    const shape: Record<string, unknown> = {};
    for (const k of keys.slice(0, 12)) {
      shape[k] = summarizeUnknownValue(o[k], depth - 1);
    }
    return { type: "object", keys, shape };
  }
  if (typeof value === "string") return { type: "string", length: value.length };
  if (typeof value === "number") return { type: "number", isFinite: Number.isFinite(value) };
  if (typeof value === "boolean") return { type: "boolean" };
  return { type: typeof value };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

export function parseNdjsonLine(line: string): ParsedNdjsonLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { kind: "unknown", reason: "invalid_json", summary: { lineLength: trimmed.length } };
  }

  if (!isRecord(parsed)) return { kind: "unknown", reason: "non_object_json", summary: summarizeUnknownValue(parsed) };
  if (parsed.v !== 0) return { kind: "unknown", reason: "unsupported_protocol_version", summary: summarizeUnknownValue(parsed) };
  if (typeof parsed.type !== "string")
    return { kind: "unknown", reason: "missing_or_nonstring_type", summary: summarizeUnknownValue(parsed) };

  const t = parsed.type;
  switch (t) {
    case "partial_reply": {
      if (typeof parsed.text !== "string")
        return { kind: "unknown", reason: "partial_reply_missing_text", unknownType: t, summary: summarizeUnknownValue(parsed) };
      return { kind: "event", event: parsed as HarnessEvent };
    }
    case "agent_event": {
      if (!("event" in parsed))
        return { kind: "unknown", reason: "agent_event_missing_event", unknownType: t, summary: summarizeUnknownValue(parsed) };
      return { kind: "event", event: parsed as HarnessEvent };
    }
    case "handshake": {
      if (
        !isRecord((parsed as any).daemon) ||
        typeof (parsed as any).daemon.version !== "string" ||
        (parsed as any).daemon.protocolVersion !== 0 ||
        !isRecord((parsed as any).health) ||
        typeof (parsed as any).health.ts !== "number" ||
        (typeof (parsed as any).health.status !== "string" ||
          (((parsed as any).health.status as string) !== "ok" && ((parsed as any).health.status as string) !== "degraded"))
      ) {
        return { kind: "unknown", reason: "handshake_invalid", unknownType: t, summary: summarizeUnknownValue(parsed) };
      }
      return { kind: "event", event: parsed as HarnessEvent };
    }
    case "tool_call": {
      if (typeof parsed.callId !== "string" || typeof parsed.name !== "string" || !("arguments" in parsed)) {
        return { kind: "unknown", reason: "tool_call_missing_fields", unknownType: t, summary: summarizeUnknownValue(parsed) };
      }
      return { kind: "event", event: parsed as HarnessEvent };
    }
    case "tool_result": {
      if (typeof parsed.callId !== "string" || !("result" in parsed)) {
        return { kind: "unknown", reason: "tool_result_missing_fields", unknownType: t, summary: summarizeUnknownValue(parsed) };
      }
      return { kind: "event", event: parsed as HarnessEvent };
    }
    case "budget": {
      if (!isRecord(parsed.remaining)) {
        return { kind: "unknown", reason: "budget_missing_remaining", unknownType: t, summary: summarizeUnknownValue(parsed) };
      }
      return { kind: "event", event: parsed as HarnessEvent };
    }
    case "heartbeat": {
      if (typeof parsed.ts !== "number") {
        return { kind: "unknown", reason: "heartbeat_missing_ts", unknownType: t, summary: summarizeUnknownValue(parsed) };
      }
      return { kind: "event", event: parsed as HarnessEvent };
    }
    case "final": {
      if (!isRecord(parsed.result) || typeof parsed.result.status !== "string") {
        return { kind: "unknown", reason: "final_missing_result", unknownType: t, summary: summarizeUnknownValue(parsed) };
      }
      if (parsed.result.status === "ok") return { kind: "event", event: parsed as HarnessEvent };
      if (parsed.result.status === "error" && isRecord(parsed.result.error) && typeof parsed.result.error.message === "string")
        return { kind: "event", event: parsed as HarnessEvent };
      return { kind: "unknown", reason: "final_invalid_result", unknownType: t, summary: summarizeUnknownValue(parsed) };
    }
    default:
      return { kind: "unknown", reason: "unknown_event_type", unknownType: t, summary: summarizeUnknownValue(parsed) };
  }
}

