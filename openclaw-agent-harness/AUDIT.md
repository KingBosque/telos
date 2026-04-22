## Append-only audit ledger

Hands-off autonomy needs an immutable “what happened” spine.

This project uses an **append-only NDJSON audit file** (one JSON object per
line), written locally by the daemon/harness (or by OpenClaw core if it offers a
native audit sink).

### File naming

- `runs/audit-YYYY-MM-DD.ndjson` (rotated daily)\n- optionally also: `runs/audit-latest.ndjson` symlink/copy

### Event schema (v0)

Each line is:

```json
{
  "v": 0,
  "ts": 1710000000000,
  "openclawSessionId": "opaque",
  "attemptId": "opaque",
  "mode": "active",
  "trigger": { "source": "schedule", "id": "opaque" },
  "intent": "short explicit intent",
  "expectedSideEffects": ["..."],
  "tool": {
    "name": "toolName",
    "callId": "opaque",
    "approved": true,
    "argumentsDigest": "sha256-or-redacted",
    "resultDigest": "sha256-or-redacted",
    "status": "ok"
  },
  "notes": { "riskScore": 20 }
}
```

Guidelines:\n- **Never** log raw secrets.\n- Store **digests** (hashes) or redacted summaries.\n- Link to transcript entries via `attemptId`.\n\n### Transcript mirroring\n\nFor searchability, each attempt should end by writing a short “audit footer”
into the OpenClaw transcript mirror:\n\n- trigger summary\n- intent\n- mode\n- tools used (names only)\n- side effects summary\n- pointer to audit file offset (line number / timestamp)\n+
