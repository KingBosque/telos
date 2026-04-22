## Tool policy + budgets (core-enforced)

This project assumes **OpenClaw core** is the enforcement point for tool policy.
The daemon/harness can *declare* a desired capability profile, but core decides
what’s actually allowed.

### Budgets (defaults)

Budgets should be applied at three levels:

1) **Per-trigger**: scheduled/event/tension can each have different limits.\n2) **Per-mode**: Active/Degraded/SafeMode/Recovery clamp budgets.\n3) **Global**: absolute hard caps to prevent runaway autonomy.

Recommended defaults (airgapped OS-wide):

- **Turns/hour**\n  - global max: 30\n  - Active: 30\n  - Degraded: 10\n  - SafeMode: 4\n  - Recovery: 6

- **Tool calls/turn**\n  - global max: 20\n  - Active: 20\n  - Degraded: 8\n  - SafeMode: 4\n  - Recovery: 6

- **Wall clock/turn**\n  - Active: 10 min\n  - Degraded: 5 min\n  - SafeMode: 2 min\n  - Recovery: 5 min

- **Per-tool timeout**\n  - Active: 60s\n  - Degraded: 30s\n  - SafeMode: 15s\n  - Recovery: 30s

### Allowlist/denylist semantics

Prefer allowlists; keep denylists small.

- `toolAllowlist: [\"*\"]` means “any tool core exposes,” subject to core policy.\n- `toolDenylist` is a last-resort block for sensitive operations (disk format, destructive ops).

### Per-trigger capability profiles

Even in Active mode, **background triggers** should use narrower profiles than
direct user-initiated runs, because they are more likely to be influenced by
untrusted inputs.

Examples:
- **ScheduledLoop**: read + housekeeping tools; limited external writes.\n- **EventIngress**: narrow to the event’s domain.\n- **TensionClock**: prefer diagnostics + rollback planning, not novel actions.

### Enforcement location

When a `tool_call` arrives from the daemon:\n- harness forwards to OpenClaw core tool execution\n- core validates:\n  - tool exists in prepared attempt\n  - args schema\n  - allowlist/denylist\n  - budget remaining\n  - approval policy\n- harness returns `tool_result` to daemon

