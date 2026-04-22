# Arcane OpenClaw Agent Harness (starter)

This package is a **starter OpenClaw Agent Harness plugin** that runs one
prepared OpenClaw agent turn through a **native runtime**.

It is **daemon-first**: it’s built to support **native sessions**, **tool
roundtrips**, and “alive” trigger surfaces (schedule/event/webhook) while still
respecting OpenClaw’s harness contract.

## What this is (and isn’t)

- **Is**: an Agent Harness plugin (`openclaw/plugin-sdk/agent-harness`) that
  implements `supports(...)` and `runAttempt(...)`.
- **Is not**: a model provider, a channel, or a tool registry. OpenClaw core
  still selects provider/model, owns transcript/session, tool policy, and
  message delivery.

## Protocol

See `PROTOCOL.md` for the NDJSON stdio protocol between the harness and the
native runtime.

Additional docs:
- `TOOL_BROKER.md` (tool_call/tool_result semantics)
- `TRIGGERS.md` (“alive” trigger surfaces without bypassing core)
- `SAFETY.md` (threat model + safety rails)

## Selection / forcing this harness

OpenClaw chooses a harness after provider/model resolution. To force this
harness:

- `OPENCLAW_AGENT_RUNTIME=arcane-native`

To ensure no silent fallback to PI (for verification):

- `OPENCLAW_AGENT_HARNESS_FALLBACK=none` or config `embeddedHarness.fallback: "none"`

## Development notes

- This repo assumes **Node.js** is available for building/running the daemon runner.
- `openclaw` is declared as a **peerDependency**. In a real OpenClaw workspace,
  the plugin build will resolve `openclaw` from the host installation.

## Phased delivery (spiral)

- **Phase 1**: spawned “daemon runner” proves streaming + session seam (`src/native/daemon-runner.ts`).
- **Phase 2**: persistent daemon transport + session binding store (keyed by OpenClaw session id).
- **Phase 3**: real tool broker (daemon requests tools; OpenClaw core executes; results returned).
- **Phase 4**: triggers (scheduled loop + event ingress + webhook ingress) that create attempts via OpenClaw.
- **Phase 5**: hardening (allowlists, approvals defaults, rate limits, auditing).
- **Phase 6**: optional provider+harness pairing (Codex-style) for model discovery/auth.

