## Trigger surfaces (making the agent feel “alive”)

OpenClaw’s Agent Harness only runs **prepared attempts**. So “alive” behavior
comes from **triggers that cause OpenClaw to create attempts**.

This harness plan supports three trigger surfaces, in increasing “aliveness”:

### 1) Scheduled loop (cadence)

- A timer creates a synthetic “system” prompt such as:
  - “Review new messages since last run and produce next actions.”
  - “Daily synthesis: summarize, decide, schedule.”
- This prompt is injected through OpenClaw’s normal command path (so the
  transcript and tool policy remain in core).

### 2) Event-driven message triggers

- Match inbound messages by:
  - channel
  - sender
  - keywords/regex
  - attachments
- On match, enqueue an attempt with:
  - explicit user intent
  - external content as **untrusted context**
  - a restricted tool allowlist

### 3) Webhook ingress (external events)

- A small local HTTP endpoint accepts webhooks (GitHub, calendar, CRM, etc.).
- It converts each webhook to an OpenClaw attempt, attaching:
  - the raw payload as untrusted context
  - an allowlisted set of tools per webhook source

### Don’t bypass core

In all cases, the trigger’s job is **only** to create an attempt. The harness:

- does not message users directly
- does not execute tools directly
- does not pick models

It only executes the prepared attempt through the daemon runtime.

