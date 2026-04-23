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
npm run typecheck
npm run build
```

The harness lists `openclaw` as a peer at runtime; the package also depends on
`openclaw` in dev for local `tsc`. Use the same major/calendar line as your
OpenClaw app. **Install the built plugin with** `openclaw plugins install` on
the packed `.tgz` (not `npm install` into the OpenClaw tree). See
[`openclaw-agent-harness/README.md`](openclaw-agent-harness/README.md) for build,
pack, and security-scanner notes.

## License

The `openclaw-agent-harness` package is [MIT](openclaw-agent-harness/package.json) unless noted otherwise in subfolders.
