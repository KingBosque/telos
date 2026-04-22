# Telos

Workspace for the **Arcane OpenClaw agent harness** and related Cursor **skills**.

## Layout

| Path | Purpose |
|------|--------|
| [`openclaw-agent-harness/`](openclaw-agent-harness/) | TypeScript package: OpenClaw Agent Harness plugin, native runtime, policy, and tooling. See its [README](openclaw-agent-harness/README.md) and docs like `PROTOCOL.md`, `SAFETY.md`. |
| [`skills/`](skills/) | Agent skill definitions (e.g. `arcane-agent-harness`). |

## Quick start (harness)

```bash
cd openclaw-agent-harness
npm install
npm run build
```

The harness expects an OpenClaw host with `openclaw` as a peer dependency. Runtime selection and env vars are documented in [`openclaw-agent-harness/README.md`](openclaw-agent-harness/README.md).

## License

The `openclaw-agent-harness` package is [MIT](openclaw-agent-harness/package.json) unless noted otherwise in subfolders.
