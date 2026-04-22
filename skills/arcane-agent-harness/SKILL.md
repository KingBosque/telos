---
name: arcane-agent-harness
description: Use the Arcane native Agent Harness runtime for OpenClaw embedded agent turns.
---

# Arcane Agent Harness (workspace skill)

This skill helps you **select and verify** the Arcane Agent Harness plugin
runtime in OpenClaw.

## What it does

- Forces OpenClaw to use the harness runtime id `arcane-native`
- Optionally disables PI fallback so you can prove the harness path is used

## How to use (operator steps)

### 1) Force the harness for a run

Set:

- `OPENCLAW_AGENT_RUNTIME=arcane-native`

### 2) Prove there is no PI fallback (recommended for smoke tests)

Set:

- `OPENCLAW_AGENT_HARNESS_FALLBACK=none`

If the harness is not registered / fails before producing side-effects, the
session should fail early instead of silently running through PI.

### 3) Run OpenClaw normally

Use your normal OpenClaw command (examples vary by installation), e.g.:

- `openclaw gateway run`

## Notes

- The Arcane harness currently runs an **echo** native runtime so you can verify
  streaming/event plumbing before integrating a real native model runtime.
- OpenClaw core still owns provider/model selection, transcript mirroring, tool
  policy, and channel delivery. This harness only executes a prepared attempt.

