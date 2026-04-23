# Arcane OpenClaw Agent Harness (starter)

This package is a **starter OpenClaw Agent Harness plugin** that runs one
prepared OpenClaw agent turn through a **native runtime**.

It is **daemon-first**: it’s built to support **native sessions**, **tool
roundtrips**, and “alive” trigger surfaces (schedule/event/webhook) while still
respecting OpenClaw’s harness contract.

## What this is (and isn’t)

- **Is**: an Agent Harness plugin (`openclaw/plugin-sdk/agent-harness`) that
  implements `supports(...)` and `runAttempt(...)`.
- **Is not**: a model provider, a channel, or a tool registry. OpenClaw core
  still selects provider/model, owns transcript/session, tool policy, and
  message delivery.

## Protocol

See `PROTOCOL.md` for the NDJSON stdio protocol between the harness and the
native runtime.

Additional docs:

- `TOOL_BROKER.md` (tool_call/tool_result semantics)
- `TRIGGERS.md` (“alive” trigger surfaces without bypassing core)
- `SAFETY.md` (threat model + safety rails)

## Selection / forcing this harness

OpenClaw chooses a harness after provider/model resolution. To force this
harness:

- `OPENCLAW_AGENT_RUNTIME=arcane-native`

To ensure no silent fallback to PI (for verification):

- `OPENCLAW_AGENT_HARNESS_FALLBACK=none` or config `embeddedHarness.fallback: "none"`

## Development notes

- This repo assumes **Node.js** is available for building/running the daemon runner.
- `openclaw` is a **peerDependency** at runtime (the host app supplies it). This
  package also lists a matching `openclaw` under **devDependencies** so `tsc` can
  resolve `openclaw/plugin-sdk/...` when you build in this folder alone. Keep the
  dev version aligned with the OpenClaw app you embed into (e.g. same install as
  `openclaw --version` on the host, or the `openclaw` version in the app’s
  `package.json`).

### Build (typecheck and compile)

```bash
cd openclaw-agent-harness
npm install
npm run typecheck
npm run build
```

If TypeScript reports type errors on `AgentHarness` or the plugin SDK, the
installed `openclaw` is likely a different version than the host; bump the
`openclaw` dev (and peer) range to match, then rebuild.

## Installing into OpenClaw (supported path)

Do **not** run `npm install` on this package **inside** the OpenClaw application’s
source or global install tree. That can hit `ERESOLVE` against OpenClaw’s own
`typescript` / `devDependencies`. Build here, then install the **artifact** with
the OpenClaw CLI.

From this directory:

```bash
npm run build
npm pack
openclaw plugins install ./arcane-openclaw-agent-harness-0.0.1.tgz
```

(`npm pack` runs `prepack`, which runs `build`, so a plain `npm pack` after
`npm install` is often enough.) Use the actual `.tgz` filename `npm pack` prints.

`package.json` includes `openclaw.extensions` pointing at `./dist/plugin.js` so
the official installer can load the extension. If the installer says the package
is not a hook pack, that is a **secondary** check; the important field is
`openclaw.extensions` for this plugin.

### `child_process` and the security scanner

This harness **spawns** the native daemon with `node:child_process` (see
`src/daemon/*.ts` and `src/runtime/cliAdapter.ts`). OpenClaw’s plugin install
scans for that and may **block** the install with “dangerous code patterns”. That
is expected for this design. For a **local, trusted** tarball, you can use the
break-glass flag documented in the [OpenClaw plugins
CLI](https://docs.openclaw.ai/cli/plugins) (e.g. `--dangerously-force-unsafe-install` on
`openclaw plugins install`). If your OpenClaw version does not honor the flag,
see upstream release notes; upgrading OpenClaw may be required.

### When install is slow or fails

- You need a **normal Node.js install** (includes `npm` and `npx`). A terminal that only exposes `node` (for example a bundled copy without the rest of the Node distribution) will not run `npm install` — use [Node.js 22+](https://nodejs.org/) and open a **new** PowerShell or cmd after installing, or use the same shell your OpenClaw app uses.
- The `openclaw` **package is very large** (tens of MB, thousands of files). The first `npm install` can take several minutes; antivirus/real-time scanning can make it worse. Prefer excluding the repo folder or waiting it out.
- The published `openclaw` release expects **Node >= 22.14** (see `engines` in `package.json`). `node -v` should satisfy that before you rely on the build.
- If a script in a dependency’s `postinstall` errors on your machine, capture the log and compare with a clean **cmd** (not WSL) run from `openclaw-agent-harness`. As a last resort, aligning `openclaw` to the **exact** version bundled with your OpenClaw app avoids “works on the host, breaks in the plugin folder” skew.

## Phased delivery (spiral)

- **Phase 1**: spawned “daemon runner” proves streaming + session seam (`src/native/daemon-runner.ts`).
- **Phase 2**: persistent daemon transport + session binding store (keyed by OpenClaw session id).
- **Phase 3**: real tool broker (daemon requests tools; OpenClaw core executes; results returned).
- **Phase 4**: triggers (scheduled loop + event ingress + webhook ingress) that create attempts via OpenClaw.
- **Phase 5**: hardening (allowlists, approvals defaults, rate limits, auditing).
- **Phase 6**: optional provider+harness pairing (Codex-style) for model discovery/auth.
