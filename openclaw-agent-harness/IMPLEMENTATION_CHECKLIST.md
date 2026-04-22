# Implementation checklist (aligned to OpenClaw harness contract)

This checklist turns the blue-sky phases into concrete, verifiable steps.

## Phase 1 — Spawned daemon runner (prove the loop)

- [x] Harness registers `AgentHarness` with stable `id` (see `src/plugin.ts`, `src/harness.ts`)
- [x] `supports(ctx)` only claims when forced or when provider matches (see `src/harness.ts`)
- [x] `runAttempt(params)`:
  - [x] streams `partial_reply` via `onPartialReply` (see `src/harness.ts`)
  - [x] streams `agent_event` via `onAgentEvent` (see `src/harness.ts`)
  - [x] returns final text (see `src/harness.ts`)
- [x] `OPENCLAW_AGENT_RUNTIME=<id>` selects harness (see `src/harness.ts`, `ARCANE_HARNESS_ID`)
- [ ] `fallback: "none"` causes hard failure if harness is missing (OpenClaw-core config; not implemented in this repo)

## Phase 2 — Persistent daemon transport

- [x] Replace spawned runner with a long-running daemon process (see `src/daemon/persistentClient.ts`, `src/native/persistent-daemon.ts`)
- [x] Add handshake (see `src/serde/attemptPayload.ts`, `src/native/persistent-daemon.ts`, `src/native/daemon-runner.ts`)
  - [x] daemon version
  - [x] protocol version
  - [x] health
- [x] Persist binding:
  - [x] `openclawSessionId -> nativeThreadId` (see `src/daemon/fileBindingStore.ts`)
  - [x] stored alongside OpenClaw session (not only in-memory) via `ARCANE_BINDINGS_PERSIST=1` → `runs/bindings.json`
- [x] Implement `reset(...)` to clear binding + tell daemon to reset native session (see `src/harness.ts`, `src/daemon/persistentClient.ts`, `src/native/persistent-daemon.ts`)

## Phase 3 — Tool broker (core-mediated)

- [x] Add daemon `tool_call` requests (demo in `src/native/persistent-daemon.ts`)
- [x] Harness forwards tool calls through OpenClaw core tool execution (see `src/core/openclawAdapters.ts`, wired in `src/harness.ts`)
- [~] Enforce per-mode/per-trigger allowlists and budgets (core)
  - [x] Enforced at the harness boundary for tool calls (see `src/harness.ts`: allow/deny, max tools/turn, wall clock)
  - [ ] Enforced by OpenClaw core tool policy (still TODO; this repo currently passes declarative intent only)
- [x] Return `tool_result` to daemon (see `src/daemon/client.ts`, `src/daemon/persistentClient.ts`)
- [~] Timeouts:
  - [x] per-tool timeout (see `src/core/openclawAdapters.ts`)
  - [x] per-turn wall-clock timeout (implemented in harness tool broker path; see `src/harness.ts`)

## Phase 4 — TriggerEngine (“alive”)

- [x] Implement scheduled cadence triggers (see `src/triggers/triggerEngine.ts`, used by `src/native/persistent-daemon.ts`)
- [x] Implement event ingress:
  - [x] file dropbox (`runs/inbox/*.json`, see `src/native/persistent-daemon.ts`)
  - [x] optional local webhook server (`ARCANE_WEBHOOK_PORT=<port>` enables `POST /event`, see `src/native/persistent-daemon.ts`)
- [x] Implement tension clock (see `src/triggers/triggerEngine.ts`)
- [x] Each trigger emits canonical envelope (see `src/triggers/triggerEngine.ts`):
  - [x] intent
  - [x] untrusted_context
  - [x] capability_profile
  - [x] expected_side_effects

## Phase 5 — RiskEngine + mode shifts + budgets

- [x] Implement mode machine (`Active/Degraded/SafeMode/Recovery`) (see `src/safety/modeMachine.ts`)
- [x] Risk signals (see `src/safety/modeMachine.ts`):
  - [x] repeated failures (`tool_failure`)
  - [x] loops (`loop_detected` exists)
  - [x] injection suspicion (`injection_suspected`)
  - [x] sensitive path touches (`sensitive_path_touched`)
- [ ] Apply mode clamps to budgets + capability profiles (profiles exist in `defaultModeConfig()`, but enforcement is still partial/demo)
- [x] Backoff strategy (never stops; slows and constrains) (operational backoff in `src/native/persistent-daemon.ts` using `computeBackoffMs()` from `src/safety/modeMachine.ts`)

## Phase 6 — Audit spine

- [x] Append-only NDJSON audit log rotation (see `src/audit/auditLedger.ts`, `AUDIT.md`)
- [x] Redaction/digest rules (digests via `AuditLedger.digestJson`, used in `src/harness.ts`)
- [x] Transcript footer per attempt (pointer into audit) (`kind:"audit_footer"` in `src/harness.ts`)

## Phase 7 — Optional provider+harness pairing (Codex-style)

- [ ] Provider plugin exposes models/auth/metadata (not implemented)
- [ ] Harness `supports(ctx)` claims only matching provider/model family (currently only claims when `OPENCLAW_AGENT_RUNTIME=arcane-native`)

## Next up (recommended order)

1) **Phase 3 enforcement (make mode profiles real in core)**
   - Wire per-mode/per-trigger allowlists + budgets into the actual tool policy enforcement boundary (OpenClaw core), not just declarative intent.
   - Ensure the daemon receives/uses the final enforced capability profile (not only the harness).

2) **Phase 5 mode clamps end-to-end**
   - Ensure mode transitions actually change the effective capability profile used for tool gating (not just recorded state).
   - Consider integrating `config/arcane-policy.json` strictness + known-event registry into the daemon/harness runtime loop.

3) **Phase 4 webhook ingress (optional, but rounds out “alive”)**
   - Add an optional local webhook server that converts inbound events into the same canonical trigger envelope.

4) **Phase 7 provider pairing (only if shipping as a full runtime)**
   - Add provider plugin metadata/models/auth and tighten `supports(ctx)` to claim only compatible traffic.
