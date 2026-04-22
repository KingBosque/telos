export type Mode = "active" | "degraded" | "safe_mode" | "recovery";

export type RiskSignal =
  | { kind: "tool_failure"; toolName: string; count: number }
  | { kind: "loop_detected"; fingerprint: string; count: number }
  | { kind: "injection_suspected"; source: string; reason: string }
  | { kind: "sensitive_path_touched"; path: string }
  | { kind: "protocol_unknown"; scope: string; reason: string }
  | { kind: "budget_exceeded"; which: "turns_per_hour" | "tools_per_turn" | "wall_clock_ms" }
  | { kind: "anomalous_spend"; reason: string };

export type CapabilityProfile = {
  /**
   * This is enforced by OpenClaw core tool policy. The daemon/harness should
   * treat it as declarative intent, not as an implementation detail.
   */
  toolAllowlist: string[];

  /**
   * Denylist exists as a last-resort guardrail for OS-wide autonomy.
   * Prefer allowlists, but denylist helps protect sensitive paths/tools.
   */
  toolDenylist: string[];

  budgets: {
    maxTurnsPerHour: number;
    maxToolCallsPerTurn: number;
    maxWallClockMsPerTurn: number;
    perToolTimeoutMs: number;
    backoff: { baseMs: number; maxMs: number };
  };
};

export type ModeConfig = {
  profiles: Record<Mode, CapabilityProfile>;
  thresholds: {
    degradeOnToolFailures: number;
    safeModeOnToolFailures: number;
    safeModeOnInjection: boolean;
    safeModeOnSensitivePath: boolean;
    recoveryAfterCleanTurns: number;
  };
};

export type ModeState = {
  mode: Mode;
  riskScore: number;
  toolFailureCount: number;
  cleanTurnStreak: number;
  lastTransitionTs: number;
};

export function computeBackoffMs(args: { profile: CapabilityProfile; state: ModeState }): number {
  const base = args.profile.budgets.backoff.baseMs;
  const max = args.profile.budgets.backoff.maxMs;
  const severity = Math.max(0, args.state.toolFailureCount) + Math.floor(Math.max(0, args.state.riskScore) / 20);
  const ms = base * Math.max(1, Math.min(64, 2 ** Math.min(6, severity)));
  return Math.max(base, Math.min(max, ms));
}

export function defaultModeConfig(): ModeConfig {
  const active: CapabilityProfile = {
    toolAllowlist: ["*"],
    toolDenylist: [
      // Keep this small and explicit; OS-wide destructive ops should be opt-in.
      "rm",
      "format",
      "diskpart",
    ],
    budgets: {
      maxTurnsPerHour: 30,
      maxToolCallsPerTurn: 20,
      maxWallClockMsPerTurn: 10 * 60_000,
      perToolTimeoutMs: 60_000,
      backoff: { baseMs: 5_000, maxMs: 5 * 60_000 },
    },
  };

  const degraded: CapabilityProfile = {
    ...active,
    budgets: {
      ...active.budgets,
      maxTurnsPerHour: 10,
      maxToolCallsPerTurn: 8,
      maxWallClockMsPerTurn: 5 * 60_000,
      perToolTimeoutMs: 30_000,
    },
  };

  const safeMode: CapabilityProfile = {
    toolAllowlist: [
      // Read-only + diagnostics by default.
      "read_file",
      "list_dir",
      "search",
      "status",
    ],
    toolDenylist: ["*"],
    budgets: {
      maxTurnsPerHour: 4,
      maxToolCallsPerTurn: 4,
      maxWallClockMsPerTurn: 2 * 60_000,
      perToolTimeoutMs: 15_000,
      backoff: { baseMs: 30_000, maxMs: 30 * 60_000 },
    },
  };

  const recovery: CapabilityProfile = {
    ...degraded,
    budgets: {
      ...degraded.budgets,
      maxTurnsPerHour: 6,
      maxToolCallsPerTurn: 6,
    },
  };

  return {
    profiles: {
      active,
      degraded,
      safe_mode: safeMode,
      recovery,
    },
    thresholds: {
      degradeOnToolFailures: 3,
      safeModeOnToolFailures: 5,
      safeModeOnInjection: true,
      safeModeOnSensitivePath: true,
      recoveryAfterCleanTurns: 3,
    },
  };
}

export function initModeState(now = Date.now()): ModeState {
  return {
    mode: "active",
    riskScore: 0,
    toolFailureCount: 0,
    cleanTurnStreak: 0,
    lastTransitionTs: now,
  };
}

export function reduceModeState(args: {
  config: ModeConfig;
  state: ModeState;
  signal: RiskSignal;
  now?: number;
}): ModeState {
  const now = args.now ?? Date.now();
  let next = { ...args.state };

  switch (args.signal.kind) {
    case "tool_failure":
      next.toolFailureCount = Math.max(next.toolFailureCount, args.signal.count);
      next.cleanTurnStreak = 0;
      next.riskScore += 10;
      break;
    case "loop_detected":
      next.cleanTurnStreak = 0;
      next.riskScore += 15;
      break;
    case "injection_suspected":
      next.cleanTurnStreak = 0;
      next.riskScore += 30;
      if (args.config.thresholds.safeModeOnInjection) next.mode = "safe_mode";
      break;
    case "sensitive_path_touched":
      next.cleanTurnStreak = 0;
      next.riskScore += 40;
      if (args.config.thresholds.safeModeOnSensitivePath) next.mode = "safe_mode";
      break;
    case "protocol_unknown":
      next.cleanTurnStreak = 0;
      next.riskScore += 50;
      next.mode = "safe_mode";
      break;
    case "budget_exceeded":
      next.cleanTurnStreak = 0;
      next.riskScore += 20;
      break;
    case "anomalous_spend":
      next.cleanTurnStreak = 0;
      next.riskScore += 20;
      break;
    default: {
      const _exhaustive: never = args.signal;
      return _exhaustive;
    }
  }

  // Threshold-based mode transitions (if not already forced into safe_mode).
  if (next.mode !== "safe_mode") {
    if (next.toolFailureCount >= args.config.thresholds.safeModeOnToolFailures) {
      next.mode = "safe_mode";
    } else if (next.toolFailureCount >= args.config.thresholds.degradeOnToolFailures) {
      next.mode = "degraded";
    }
  }

  if (next.mode !== args.state.mode) next.lastTransitionTs = now;
  return next;
}

export function noteCleanTurn(state: ModeState, config: ModeConfig, now = Date.now()): ModeState {
  const next: ModeState = {
    ...state,
    cleanTurnStreak: state.cleanTurnStreak + 1,
    riskScore: Math.max(0, state.riskScore - 5),
  };

  if (next.mode === "safe_mode" && next.cleanTurnStreak >= config.thresholds.recoveryAfterCleanTurns) {
    return { ...next, mode: "recovery", lastTransitionTs: now };
  }
  if (next.mode === "recovery" && next.cleanTurnStreak >= config.thresholds.recoveryAfterCleanTurns * 2) {
    return { ...next, mode: "active", lastTransitionTs: now };
  }
  return next;
}

