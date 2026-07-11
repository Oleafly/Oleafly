# Development

What you need to work on OpenLeaf. The app is a [Tauri 2](https://tauri.app) project: a React + TypeScript + Vite frontend that talks over IPC to a Rust backend, which spawns the Tectonic compiler as a sidecar.

## Repo layout

```
localeaf/
├── src/                    React app shell (stores, Tauri client, UI kit, port adapters)
│   ├── components/         ui (shadcn-style), layout, editor glue, preview panes, ai
│   ├── contributions/      registers rail tabs / commands / AI toolsets into the registry
│   ├── features/           compile, synctex, export
│   ├── lib/                tauri wrappers, github, spellcheck, utils, package shims
│   └── store/              zustand stores
├── packages/               @openleaf/* engine packages (consumed as TS source)
│   ├── latex/  ai-core/  registry/  preflight/
│   └── editor/  preview/  diagram/  ai-tools/  templates/
├── src-tauri/
│   ├── src/                rust: commands, config, git, github, paths, project, synctex
│   ├── binaries/           tectonic-<triple>[.exe] sidecars (fetched)
│   ├── resources/          templates, dictionaries, tex bundle
│   └── tauri.conf.json
├── scripts/fetch-tectonic.sh
└── docs/
```

The frontend is a pnpm workspace: feature engines live in `packages/*` behind
injected ports, and the app shell wires them together. Read
[Frontend architecture](architecture.md) before touching `packages/` — it
covers the port pattern, the contribution registry, and the alias wiring.

## Prerequisites

- Node.js 20+, pnpm
- Rust (stable) via [rustup](https://rustup.rs)
- [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/) for your OS
- Optional: [pandoc](https://pandoc.org/installing.html) for non-PDF export

## First run

```bash
./scripts/fetch-tectonic.sh all     # fetch compiler sidecars for all platforms
pnpm install
pnpm tauri dev
```

For a single platform: `./scripts/fetch-tectonic.sh aarch64-apple-darwin` (use `rustc -vV` to find your target triple).

## Day-to-day

```bash
pnpm tauri dev          # run the app with hot reload (frontend) + cargo incremental (backend)
pnpm build              # typecheck + build the frontend (tsc -b && vite build)
pnpm tauri build        # produce a distributable bundle
```

### Checks before opening a PR

Make sure both pass:

```bash
pnpm build                                # frontend typecheck (noUnusedLocals/Parameters on)
pnpm test                                 # vitest across src/ and packages/
cd src-tauri && cargo check               # backend compiles
```

For user-facing changes, also run the end-to-end suite (real app, real
compiles; see [e2e/README.md](../e2e/README.md)):

```bash
pnpm test:e2e:app                         # builds + launches the app, runs Playwright, tears down
```

## How a compile works

1. Frontend calls `compileProject(projectId, mainDoc, offline)` via Tauri IPC.
2. Rust writes a small wrapper (`_openleaf_entry.tex`) that neutralizes pdfLaTeX-only commands under XeTeX.
3. Spawns the `tectonic` sidecar with `--synctex --keep-logs --print` (and `--only-cached` when offline).
4. Streams stdout/stderr to the log pane; on exit returns PDF bytes (base64) + `.synctex.gz` + parsed errors.
5. The frontend renders the PDF with pdf.js and turns errors into CodeMirror diagnostics.

## Where state lives

- Config and secrets: `~/.openleaf/config.json` (`0600` on Unix). Holds the GitHub token, AI provider/model, and per-provider AI keys.
- Projects: `~/.openleaf/projects/<id>/`, plain folders with `.git`.
- App log: `~/.openleaf/app.log`.

## Key extension points

- Add an AI provider → `packages/ai-core/src/providers.ts` (`PROVIDERS` + `buildModel`). OpenAI-compatible providers just need a `baseURL`.
- Add a Tauri command → declare in `src-tauri/src/*.rs`, register in `src-tauri/src/lib.rs`, wrap in `src/lib/tauri.ts`.
- Add a project template → drop a folder with a `template.json` manifest into `src-tauri/resources/templates/`.
- Add a tool for the AI → `packages/ai-tools/src/tools.ts`; app services it needs go through `AiToolsHost` (adapter in `src/lib/ai-tools.ts`).
- Add a rail tab / palette or omnibar command / AI toolset → register it in `src/contributions/` (see [Frontend architecture](architecture.md#the-contribution-registry)).

## Sync and GitHub internals

OAuth device flow runs server-side in Rust (`src-tauri/src/github.rs`) because the OAuth endpoints aren't CORS-enabled. The API calls (api.github.com) happen from the frontend.

## Coding style

- TypeScript: follow what's already there. No comments unless asked. Respect `noUnusedLocals`/`noUnusedParameters`.
- Rust: idiomatic, small commands, friendly error strings.
- UI: Tailwind v4 + Geist tokens; reuse the `Button`/`Tooltip`/`Select` primitives.

## Releasing

Packaging and signing are still being set up. The goal is a notarized `.dmg` (macOS, universal), EV-signed `.msi`/`.exe` (Windows x64), and `.AppImage`/`.deb` (Linux), each with the matching Tectonic sidecar fetched in CI via `scripts/fetch-tectonic.sh`.
