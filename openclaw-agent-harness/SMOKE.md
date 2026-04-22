## Smoke test: prove harness path is used

This repo cannot run end-to-end in isolation without:

- a real OpenClaw installation that loads this plugin, and
- Node.js tooling for building the TypeScript.

That said, you can still **prove selection + fallback behavior** in a real
OpenClaw environment.

### 1) Build the plugin

From `openclaw-agent-harness/`:

- `npm install`
- `npm run build`

### 2) Ensure OpenClaw loads the plugin

Add this plugin to your OpenClaw plugin allowlist / plugin discovery path as
appropriate for your OpenClaw install.

Expected harness id: `arcane-native` (see `src/harness.ts`).

### 3) Force runtime and disable fallback

Run OpenClaw with:

- `OPENCLAW_AGENT_RUNTIME=arcane-native`
- `OPENCLAW_AGENT_HARNESS_FALLBACK=none`

This makes failures **hard** (no PI fallback), which is the cleanest proof that
the plugin harness is being exercised.

### 4) Run a single embedded agent turn

Use any workflow that triggers an embedded agent turn. The echo runtime should:

- stream partial reply chunks
- emit an `agent_event` trace line
- complete with a `final` event

If the harness is not registered, does not support the resolved provider/model,
or fails before producing side effects, OpenClaw should fail early.

