import type { CapabilityProfile, Mode } from "../safety/modeMachine.js";

export type TriggerSource = "schedule" | "event" | "tension";

export type TriggerEnvelope = {
  id: string;
  ts: number;
  source: TriggerSource;

  /**
   * Short, explicit objective. This is the only “instructional” field.
   */
  intent: string;

  /**
   * Untrusted payloads (emails, webhooks, logs). Never treated as instructions.
   */
  untrustedContext: Record<string, unknown>;

  /**
   * Declarative capability/budget intent. OpenClaw core enforces actual policy.
   */
  capabilityProfile: CapabilityProfile;

  /**
   * Declared side effects (for audit).
   */
  expectedSideEffects: string[];

  modeAtEnqueue: Mode;
};

export type TriggerEngineConfig = {
  schedule: {
    enabled: boolean;
    // Example cadences; real implementation will use cron-like config.
    hourly: boolean;
    daily: boolean;
  };
  tension: {
    enabled: boolean;
    maxOpenLoopsBeforeStabilize: number;
    maxRecentFailuresBeforeStabilize: number;
  };
};

export type TriggerEngineState = {
  openLoops: number;
  recentFailures: number;
};

export type TriggerEngine = {
  tick: (args: {
    now?: number;
    mode: Mode;
    capabilityProfile: CapabilityProfile;
    state: TriggerEngineState;
  }) => TriggerEnvelope[];
  ingestEvent: (args: {
    now?: number;
    mode: Mode;
    capabilityProfile: CapabilityProfile;
    event: { kind: string; payload: Record<string, unknown> };
  }) => TriggerEnvelope[];
};

export function createTriggerEngine(config: TriggerEngineConfig): TriggerEngine {
  return {
    tick({ now, mode, capabilityProfile, state }) {
      const ts = now ?? Date.now();
      const out: TriggerEnvelope[] = [];

      if (config.schedule.enabled && config.schedule.hourly) {
        out.push({
          id: randomId(),
          ts,
          source: "schedule",
          intent: "Hourly maintenance + triage sweep. Produce next actions and stabilize open loops.",
          untrustedContext: {},
          capabilityProfile,
          expectedSideEffects: ["may read logs", "may update local notes", "may schedule next check-ins"],
          modeAtEnqueue: mode,
        });
      }

      if (config.tension.enabled) {
        const tensionTriggered =
          state.openLoops >= config.tension.maxOpenLoopsBeforeStabilize ||
          state.recentFailures >= config.tension.maxRecentFailuresBeforeStabilize;
        if (tensionTriggered) {
          out.push({
            id: randomId(),
            ts,
            source: "tension",
            intent: "Stabilize: reduce open loops, stop repeated failures, and produce a safe recovery plan.",
            untrustedContext: { openLoops: state.openLoops, recentFailures: state.recentFailures },
            capabilityProfile,
            expectedSideEffects: ["may pause triggers", "may reduce tool usage", "may propose rollbacks"],
            modeAtEnqueue: mode,
          });
        }
      }

      return out;
    },

    ingestEvent({ now, mode, capabilityProfile, event }) {
      const ts = now ?? Date.now();
      if (!config.schedule.enabled && !config.tension.enabled) {
        // still allow event ingress even if other clocks are disabled
      }

      return [
        {
          id: randomId(),
          ts,
          source: "event",
          intent: `Handle event: ${event.kind}. Extract signal, decide action, execute under policy.`,
          untrustedContext: event.payload,
          capabilityProfile,
          expectedSideEffects: ["may read related files", "may call allowed tools to respond"],
          modeAtEnqueue: mode,
        },
      ];
    },
  };
}

function randomId(): string {
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

