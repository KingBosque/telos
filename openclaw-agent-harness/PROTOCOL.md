## OpenClaw Agent Harness ↔ Native Runtime Protocol (v0)

This harness is designed to run an OpenClaw **prepared attempt** via a native
runtime, starting with a **local CLI** and evolving into a **daemon** transport.

The harness communicates using **newline-delimited JSON (NDJSON)** over stdio:

- **Harness → CLI**: one JSON object on **stdin**, then stdin closes.
- **CLI → Harness**: zero or more JSON objects on **stdout**, each on its own
  line. stderr is reserved for diagnostics.

This keeps streaming simple and makes it easy to proxy to a daemon later.

### Daemon-first envelope (Phase 1+)

To support daemon semantics (native session binding + tool roundtrips), the
harness sends an initial envelope:

```json
{
  "v": 0,
  "type": "attempt",
  "payload": { "...": "HarnessAttemptPayload" },
  "binding": { "openclawSessionId": "opaque", "nativeThreadId": "opaque" }
}
```

In spawned-runner mode, this envelope is still delivered over stdio.

### Input (Harness → CLI)

The harness sends exactly one JSON line:

```json
{
  "v": 0,
  "attemptId": "uuid-or-random",
  "prompt": "full prepared attempt prompt text",
  "model": "provider/model",
  "provider": "provider",
  "tools": [{ "name": "toolName", "description": "…", "schema": {} }],
  "images": [],
  "session": {
    "openclawSessionId": "opaque",
    "transcriptPath": "path-if-provided"
  },
  "policy": {
    "sandbox": "opaque",
    "toolApproval": "opaque"
  }
}
```

Notes:
- `tools` is informational for the echo runtime; a real runtime would use it to
  decide when to request tool calls.
- `session` fields are **opaque** identifiers provided by OpenClaw; the harness
  does not invent them.

### Output events (CLI → Harness)

Each output line is a single JSON event with a `type` discriminator:

#### `partial_reply`
Stream assistant text deltas.

```json
{ "v": 0, "type": "partial_reply", "text": "chunk of assistant text" }
```

#### `agent_event`
Emit structured trace-like events. These are forwarded to
`params.onAgentEvent(...)`.

```json
{ "v": 0, "type": "agent_event", "event": { "kind": "trace", "message": "…" } }
```

#### `tool_call` (optional / future)
Request that OpenClaw executes a tool. The harness will translate this into the
OpenClaw tool-call pathway and return a `tool_result` back to the runtime in a
future protocol revision (or via a daemon channel).

```json
{
  "v": 0,
  "type": "tool_call",
  "callId": "opaque",
  "name": "toolName",
  "arguments": {}
}
```

#### `tool_result` (optional / future)
The harness returns tool results to the native runtime using the same NDJSON
channel (stdio for spawned mode; a daemon transport later).

```json
{
  "v": 0,
  "type": "tool_result",
  "callId": "opaque",
  "result": {}
}
```

#### `heartbeat` (optional)
Allows the runtime to signal liveness/health.

```json
{ "v": 0, "type": "heartbeat", "ts": 1710000000000, "status": "ok" }
```

#### `final`
Signals completion. The harness resolves `runAttempt` once this arrives.

```json
{
  "v": 0,
  "type": "final",
  "result": {
    "status": "ok",
    "text": "full assistant text (optional if streamed)",
    "native": { "threadId": null }
  }
}
```

If the runtime fails, it should exit non-zero and/or emit:

```json
{
  "v": 0,
  "type": "final",
  "result": { "status": "error", "error": { "message": "…" } }
}
```

### Versioning

The `v` field is a protocol version integer. v0 is intentionally minimal.
Any breaking change increments `v`.

