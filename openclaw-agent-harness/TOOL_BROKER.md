## Tool broker contract (daemon ↔ harness ↔ OpenClaw core)

The **native runtime (daemon)** may want to call tools dynamically during a turn.
However, OpenClaw core must remain the system of record for:

- tool policy and approvals
- tool execution
- transcript mirroring and media delivery

So the daemon does **not** execute tools directly. It requests them; OpenClaw
executes them; results are returned to the daemon.

### Request: `tool_call`

Daemon → Harness (NDJSON):

```json
{
  "v": 0,
  "type": "tool_call",
  "callId": "opaque",
  "name": "toolName",
  "arguments": {}
}
```

Rules:
- `callId` must be unique within the attempt.
- `name` must match a tool in `params.tools`.
- `arguments` must conform to the tool schema (validation happens in core).

### Execution (inside harness)

Harness behavior:
- forward the request through the **OpenClaw core tool-call pathway** for this
  prepared attempt
- respect approvals/policy (core enforces)
- capture the tool result as returned by core (including errors)

### Response: `tool_result`

Harness → Daemon (NDJSON):

```json
{
  "v": 0,
  "type": "tool_result",
  "callId": "opaque",
  "result": {}
}
```

`result` may be either:
- the tool’s success output, or
- a structured error payload.

### Failure and timeout semantics

- **Tool timeout**: harness should implement a per-tool timeout and return a
  `tool_result` error object; the daemon must decide whether to retry or abort.
- **Approval denied**: core denies; harness returns a `tool_result` with an
  explicit approval-denied error shape.
- **Unknown tool**: harness returns `tool_result` error and emits `agent_event`
  trace explaining the violation.\n+
### Safety constraints

- The daemon must treat all external content (emails, web pages, chat logs) as
  untrusted input and must never smuggle it into tool arguments without an
  explicit intent boundary.\n+
