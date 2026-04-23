import type {
  AgentHarness,
  AgentHarnessAttemptParams,
  AgentHarnessAttemptResult,
  AgentHarnessResetParams,
} from "openclaw/plugin-sdk/agent-harness";
import type { HarnessAttemptPayload, TriggerSource } from "./serde/attemptPayload.js";
import { asArcaneAttemptParams, type ArcaneHarnessAttemptParams } from "./openclaw-params.js";
import { createSpawnedDaemonClient } from "./daemon/client.js";
import { InMemoryBindingStore } from "./daemon/inMemoryBindings.js";
import { FileBindingStore } from "./daemon/fileBindingStore.js";
import { createAuditLedger } from "./audit/auditLedger.js";
import { executeToolViaOpenClawCore } from "./core/openclawAdapters.js";
import { createPersistentDaemonClient } from "./daemon/persistentClient.js";
import { defaultModeConfig, initModeState, noteCleanTurn, reduceModeState, type CapabilityProfile, type ModeState } from "./safety/modeMachine.js";
import { loadPolicy } from "./policy/loadPolicy.js";
import { createTurnsPerHourLimiter } from "./safety/turnBudget.js";

export const ARCANE_HARNESS_ID = "arcane-native";

/** OpenClaw uses `clientTools` on the attempt params; this starter also accepts legacy `tools` for the daemon payload. */
function resolveToolListForPayload(params: AgentHarnessAttemptParams | ArcaneHarnessAttemptParams): HarnessAttemptPayload["tools"] {
  const p = params as ArcaneHarnessAttemptParams & {
    tools?: HarnessAttemptPayload["tools"];
  };
  if (Array.isArray(p.tools) && p.tools.length > 0) {
    return p.tools.map((t) => ({
      name: String(t.name),
      description: safeString(t.description),
      schema: (t as { schema?: unknown }).schema,
    }));
  }
  const clientTools = p.clientTools;
  if (Array.isArray(clientTools) && clientTools.length > 0) {
    return clientTools.map((t) => {
      const tool = t as unknown as Record<string, unknown>;
      return {
        name: typeof tool.name === "string" ? tool.name : "unknown_tool",
        description: safeString(tool.description),
        schema: tool.schema ?? tool.parameters,
      };
    });
  }
  return [];
}

function safeString(x: unknown): string | undefined {
  return typeof x === "string" ? x : undefined;
}

function toolNameAllowed(args: { profile: CapabilityProfile; toolName: string }): boolean {
  const { profile, toolName } = args;
  const allow = profile.toolAllowlist;
  const deny = profile.toolDenylist;
  const matches = (patterns: string[]) => patterns.some((p) => p === "*" || p === toolName);
  if (matches(deny)) return false;
  return matches(allow);
}

export function createArcaneHarness(_options?: { pluginConfig?: unknown }): AgentHarness {
  void _options;
  const bindings = process.env.ARCANE_BINDINGS_PERSIST === "1" ? new FileBindingStore() : new InMemoryBindingStore();
  const audit = createAuditLedger();
  const turnsPerHour = createTurnsPerHourLimiter({ maxTurnsPerHour: defaultModeConfig().profiles.active.budgets.maxTurnsPerHour });

  const usePersistent = process.env.ARCANE_DAEMON_PERSISTENT === "1";
  const daemon = usePersistent
    ? createPersistentDaemonClient({
        command: process.execPath,
        args: [new URL("./native/persistent-daemon.js", import.meta.url).pathname],
      })
    : createSpawnedDaemonClient({
        command: process.execPath,
        args: [new URL("./native/daemon-runner.js", import.meta.url).pathname],
      });

  const harness: AgentHarness = {
    id: ARCANE_HARNESS_ID,
    label: "Arcane Native Harness (daemon-first starter)",

    supports(ctx) {
      // Default: only claim when explicitly targeted.
      // Operators can set OPENCLAW_AGENT_RUNTIME=arcane-native.
      // If you later add a provider plugin, tighten this to claim only that provider.
      if (process.env.OPENCLAW_AGENT_RUNTIME === ARCANE_HARNESS_ID) {
        return { supported: true, priority: 100 };
      }
      if (process.env.OPENCLAW_AGENT_RUNTIME === "auto") {
        return { supported: false };
      }
      // In auto mode, avoid accidentally stealing traffic.
      return { supported: false };
    },

    async runAttempt(params: AgentHarnessAttemptParams): Promise<AgentHarnessAttemptResult> {
      const p = asArcaneAttemptParams(params);
      let streamed = "";
      const attemptStartTs = Date.now();
      let toolCallsThisTurn = 0;
      let streamedChars = 0;
      let streamingCapped = false;

      const openclawSessionId =
        safeString(p.sessionId) ?? safeString(p.openclawSessionId) ?? "unknown-session";
      const binding = bindings.get(openclawSessionId);
      const policy = loadPolicy({ scope: { openclawSessionId, nativeThreadId: binding?.nativeThreadId } });
      const attemptId = cryptoRandomId();
      const modeConfig = defaultModeConfig();
      let modeState: ModeState = initModeState();
      const trigger = p.trigger;
      const triggerId = typeof trigger?.id === "string" ? trigger.id : undefined;
      const triggerSource = typeof trigger?.source === "string" ? trigger.source : "unknown";
      const intent = safeString(p.intent) ?? safeString(p.objective) ?? "interactive_attempt";
      const untrustedContext =
        p.untrustedContext && typeof p.untrustedContext === "object"
          ? (p.untrustedContext as Record<string, unknown>)
          : undefined;
      const expectedSideEffects = Array.isArray(p.expectedSideEffects) ? p.expectedSideEffects.map(String) : [];
      const capabilityProfile =
        p.capabilityProfile && typeof p.capabilityProfile === "object" ? (p.capabilityProfile as Record<string, unknown>) : undefined;

      const effectiveProfileForMode = (m: keyof typeof modeConfig.profiles): CapabilityProfile => {
        if (m !== "safe_mode" || policy.derived.safeModeAllowlistAdd.length === 0) return modeConfig.profiles[m];
        return {
          ...modeConfig.profiles.safe_mode,
          toolAllowlist: [...modeConfig.profiles.safe_mode.toolAllowlist, ...policy.derived.safeModeAllowlistAdd],
        };
      };

      const derivedCapabilityProfile: CapabilityProfile = effectiveProfileForMode(modeState.mode);

      // Turn admission control: enforce turns/hour per OpenClaw session to keep trigger storms cost-bounded.
      {
        const profile = effectiveProfileForMode(modeState.mode);
        const maxTurnsPerHour = Math.max(1, Math.floor(profile.budgets.maxTurnsPerHour));
        const countInWindow = turnsPerHour.noteEvent(openclawSessionId, attemptStartTs);
        if (countInWindow > maxTurnsPerHour) {
          modeState = reduceModeState({
            config: modeConfig,
            state: modeState,
            signal: { kind: "budget_exceeded", which: "turns_per_hour" },
          });

          p.onAgentEvent?.({
            kind: "budget_exceeded",
            which: "turns_per_hour",
            maxTurnsPerHour,
            countInWindow,
            remaining: Math.max(0, maxTurnsPerHour - countInWindow),
            openclawSessionId,
            trigger: { source: triggerSource, id: triggerId },
          } as any);

          audit.append({
            openclawSessionId,
            attemptId,
            mode: modeState.mode,
            trigger: { source: triggerSource, id: triggerId },
            intent,
            expectedSideEffects,
            notes: { reason: "turns_per_hour_budget_exceeded", maxTurnsPerHour, countInWindow },
          });

          return { text: "", native: { error: "turns_per_hour_budget_exceeded" } } as unknown as AgentHarnessAttemptResult;
        }
      }

      const payload: HarnessAttemptPayload = {
        v: 0,
        attemptId,
        prompt: p.prompt,
        intent,
        untrustedContext,
        expectedSideEffects,
        capabilityProfile: capabilityProfile ?? (derivedCapabilityProfile as unknown as Record<string, unknown>),
        trigger: { source: triggerSource as TriggerSource, id: triggerId },
        model: safeString(p.model),
        provider: safeString(p.provider),
        tools: resolveToolListForPayload(p),
        images: (p as { images?: HarnessAttemptPayload["images"] }).images ?? [],
        session: {
          openclawSessionId: safeString(p.sessionId),
          transcriptPath: safeString(p.transcriptPath),
        },
        policy: {
          sandbox: p.sandbox,
          toolPolicy: p.toolPolicy,
        },
      };

      const result = await daemon.runAttempt({
        payload,
        binding,
        onToolCall: async (toolCall) => {
          toolCallsThisTurn += 1;
          const elapsedMs = Date.now() - attemptStartTs;
          const profile = effectiveProfileForMode(modeState.mode);
          const toolTimeoutMs = Math.min(
            Number(
              p.toolPolicy && typeof p.toolPolicy === "object" && "perToolTimeoutMs" in p.toolPolicy
                ? (p.toolPolicy as { perToolTimeoutMs?: unknown }).perToolTimeoutMs
                : profile.budgets.perToolTimeoutMs,
            ),
            profile.budgets.perToolTimeoutMs,
          );

          if (elapsedMs > profile.budgets.maxWallClockMsPerTurn) {
            modeState = reduceModeState({
              config: modeConfig,
              state: modeState,
              signal: { kind: "budget_exceeded", which: "wall_clock_ms" },
            });
            return { error: { code: "wall_clock_timeout", message: `Per-turn wall clock exceeded (${profile.budgets.maxWallClockMsPerTurn}ms)` } };
          }

          if (toolCallsThisTurn > profile.budgets.maxToolCallsPerTurn) {
            modeState = reduceModeState({
              config: modeConfig,
              state: modeState,
              signal: { kind: "budget_exceeded", which: "tools_per_turn" },
            });
            return { error: { code: "tool_budget_exceeded", message: `Tool call budget exceeded (${profile.budgets.maxToolCallsPerTurn})` } };
          }

          if (!toolNameAllowed({ profile, toolName: toolCall.name })) {
            modeState = reduceModeState({
              config: modeConfig,
              state: modeState,
              signal: { kind: "protocol_unknown", scope: "tool_policy", reason: `disallowed_tool:${toolCall.name}` },
            });
            return { error: { code: "tool_disallowed", message: `Tool not allowed in mode=${modeState.mode}: ${toolCall.name}` } };
          }

          const exec = await executeToolViaOpenClawCore({
            params: p,
            toolCall: { callId: toolCall.callId, name: toolCall.name, arguments: toolCall.arguments },
            timeoutMs: toolTimeoutMs,
          });

          modeState = exec.ok ? noteCleanTurn(modeState, modeConfig) : reduceModeState({
            config: modeConfig,
            state: modeState,
            signal: { kind: "tool_failure", toolName: toolCall.name, count: modeState.toolFailureCount + 1 },
          });

          const policyBasis = exec.ok
            ? { reason: "core_tool_execution_ok" }
            : { reason: exec.error?.code ?? "core_tool_execution_error", details: { message: exec.error?.message } };

          audit.append({
            openclawSessionId,
            attemptId,
            mode: modeState.mode,
            trigger: { source: triggerSource, id: triggerId },
            intent,
            expectedSideEffects,
            tool: {
              name: toolCall.name,
              callId: toolCall.callId,
              approved: typeof exec.approved === "boolean" ? exec.approved : "unknown",
              policyBasis: { reason: policyBasis.reason, detailsDigest: audit.digestJson(policyBasis.details ?? {}) },
              reason: safeString((toolCall as any).reason),
              expectedSideEffects: Array.isArray((toolCall as any).expectedSideEffects)
                ? ((toolCall as any).expectedSideEffects as unknown[]).map(String)
                : undefined,
              dataProvenance: safeString((toolCall as any).dataProvenance),
              argumentsDigest: audit.digestJson(toolCall.arguments),
              resultDigest: audit.digestJson(exec.ok ? exec.result : exec.error),
              status: exec.ok ? "ok" : "error",
            },
            notes: exec.ok ? { triggerId } : { triggerId, error: exec.error },
          });

          p.onAgentEvent?.({
            kind: "budget_remaining",
            remaining: {
              toolCallsThisTurn: Math.max(0, profile.budgets.maxToolCallsPerTurn - toolCallsThisTurn),
              wallClockMsThisTurn: Math.max(0, profile.budgets.maxWallClockMsPerTurn - elapsedMs),
            },
            mode: modeState.mode,
          } as any);

          return exec.ok
            ? { result: exec.result, approved: exec.approved ?? undefined, policyBasis }
            : { error: exec.error, approved: exec.approved ?? undefined, policyBasis };
        },
        onEvent: (evt) => {
          switch (evt.type) {
            case "partial_reply":
              if (!streamingCapped) {
                const nextChars = streamedChars + evt.text.length;
                const maxChars = 200_000;
                if (nextChars > maxChars) {
                  streamingCapped = true;
                  modeState = reduceModeState({
                    config: modeConfig,
                    state: modeState,
                    signal: { kind: "anomalous_spend", reason: `partial_reply_exceeded:${maxChars}` },
                  });
                  p.onAgentEvent?.({
                    kind: "protocol_violation",
                    scope: "partial_reply",
                    reason: "streaming_cap_exceeded",
                    maxChars,
                    observedChars: nextChars,
                  } as any);
                } else {
                  streamedChars = nextChars;
                  streamed += evt.text;
                  void p.onPartialReply?.({ text: evt.text });
                }
              }
              break;
            case "agent_event":
              p.onAgentEvent?.(evt.event as any);
              break;
            case "handshake":
              p.onAgentEvent?.({ kind: "handshake", ...evt } as any);
              break;
            case "heartbeat":
              p.onAgentEvent?.({ kind: "heartbeat", ts: evt.ts, status: evt.status } as any);
              break;
            case "budget":
              p.onAgentEvent?.({
                kind: "budget_remaining",
                remaining: {
                  turnsPerHour: evt.remaining.turnsPerHour,
                  toolCallsThisTurn: evt.remaining.toolCallsThisTurn,
                  wallClockMsThisTurn: evt.remaining.wallClockMsThisTurn,
                },
                mode: modeState.mode,
              } as any);
              break;
            case "tool_call":
            case "tool_result":
            case "final":
              // tool_call/tool_result are handled by the daemon client; final is handled after await
              break;
          }
        },
      });

      // Return shape depends on the SDK; keep it minimal and rely on transcript mirroring
      // via callbacks. We still return a final assistant text for compatibility.
      const finalText = result.finalText ?? streamed;

      // Persist binding if the daemon returns one (Phase 2+).
      if (result.binding) bindings.set(result.binding as any);

      // Attempt footer (searchable): no secrets, no raw tool args.
      const auditPath = audit.ledgerPathForDate();
      p.onAgentEvent?.({
        kind: "audit_footer",
        attemptId,
        mode: modeState.mode,
        trigger: { source: triggerSource, id: triggerId },
        intent,
        expectedSideEffects,
        toolsUsed: ["(see audit ledger)"],
        auditLedgerPath: auditPath,
      } as any);

      return {
        text: finalText,
        native: result.native ?? {},
      } as unknown as AgentHarnessAttemptResult;
    },

    async reset(ctx: AgentHarnessResetParams) {
      const c = ctx as AgentHarnessResetParams & { openclawSessionId?: string };
      const openclawSessionId = safeString(c.sessionId) ?? safeString(c.openclawSessionId) ?? safeString(c.sessionKey);
      if (!openclawSessionId) return;
      const binding = bindings.get(openclawSessionId);
      await daemon.resetSession({ openclawSessionId, binding });
      bindings.delete(openclawSessionId);
    },
  };

  return harness;
}

function cryptoRandomId(): string {
  // Avoid depending on crypto UUID APIs in case Node runtime varies.
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

