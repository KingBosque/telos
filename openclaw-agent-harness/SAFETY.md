## Safety rails (threat model + controls)

This harness is explicitly designed for **trusted native runtimes**, but it must
still defend against **untrusted content** flowing through triggers.

### Threat model (high-level)

- **Prompt injection** from emails, web pages, DMs, webhook payloads.
- **Tool exfiltration**: attacker tries to coerce a tool call that leaks secrets.
- **Tool misuse**: attacker tries to get destructive actions approved implicitly.
- **Runaway autonomy**: loops that spam turns/tools, burn budget, or flood channels.
- **State poisoning**: attacker tries to corrupt the daemon’s native session memory.

### Core safety principle

**Untrusted content never becomes executable intent.**

Intent boundaries:
- **Intent**: short, explicit instruction derived from user/operator policy.
- **Context**: untrusted payloads; always labeled as untrusted.
- **Actions**: tool calls, always mediated by core policy/approvals.

### Controls to implement (ordered)

1) **Per-trigger tool allowlists**
- Each trigger source (schedule, message, webhook) has an allowlist of tools.
- Default deny: if no allowlist is configured, the trigger cannot request tools.

2) **Approval strictness**
- High-risk tools always require explicit approval.
- Background triggers should default to “approval required” unless operator opts out.

3) **Rate limits + budgets**
- Max turns per hour (per trigger and global)
- Max tool calls per turn
- Backoff on repeated failures
- Kill switch: pause triggers

4) **Audit logging**
- Record: trigger source, intent string, tool calls requested, approvals, outcomes.
- Keep logs local by default; redact secrets.

5) **Session hygiene**
- Reset hook clears native session binding when OpenClaw session resets.
- Consider periodic compaction / forgetting policies in daemon memory.

### Failure posture

- When `fallback: "none"` is set, harness failures should be **hard** and visible.
- In `auto` mode, allow PI fallback only if the attempt has produced **no side effects**.

