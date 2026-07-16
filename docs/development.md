# Development

What you need to work on OpenLeaf. The app is a [Tauri 2](https://tauri.app) project: a React + TypeScript + Vite frontend that talks over IPC to a Rust backend. Rust selects a compiler through the `DocumentEngine` interface. LaTeX and Typst use shipped CLI sidecars. Markdown uses a discovered or on-demand Pandoc executable with the shipped Tectonic executable as Pandoc's PDF engine.

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
│   ├── src/                rust: commands, DocumentEngine, config, git, paths, project, synctex
│   ├── binaries/           tectonic-/typst-<triple>[.exe] sidecars (fetched)
│   ├── resources/          templates, dictionaries, tex bundle
│   └── tauri.conf.json
├── scripts/fetch-tectonic.sh
├── scripts/fetch-typst.sh
└── docs/
```

The frontend is a pnpm workspace: feature engines live in `packages/*` behind
injected ports, and the app shell wires them together. Read
[Frontend architecture](architecture.md) before touching `packages/`: it
covers the port pattern, the contribution registry, and the alias wiring.

## Prerequisites

- Node.js 22.13+ and pnpm 11.9+ (the exact pnpm version is declared in
  `package.json`)
- Rust (stable) via [rustup](https://rustup.rs)
- [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/) for your OS
- Optional during setup: [pandoc](https://pandoc.org/installing.html) for Markdown PDF compilation and document export (the app can install its pinned build on demand)

## First run

```bash
./scripts/fetch-tectonic.sh all     # fetch compiler sidecars for all platforms
./scripts/fetch-typst.sh all
pnpm install
pnpm tauri dev
```

For a single platform, pass the same host triple to both fetch scripts (use `rustc -vV` to find it).

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
pnpm audit --prod --audit-level high      # registry-backed npm advisory check
cd src-tauri && cargo check               # backend compiles
cd src-tauri && cargo deny check           # Rust advisories, licenses, and sources
```

The two audit commands require registry/network access. CI records their
current results on every code change. An offline local run cannot certify that
the dependency graph is advisory-free.

For user-facing changes, also run the end-to-end suite (real app, real
compiles; see [e2e/README.md](../e2e/README.md)):

```bash
pnpm test:e2e:app                         # builds + launches the app, runs Playwright, tears down
```

## How a compile works

1. The frontend loads the backend `project_engine` descriptor and its capability flags, then calls `compileProject(projectId, mainDoc, offline)` through Tauri IPC.
2. Rust dispatches through `DocumentEngine`. UI code must not infer engine behavior from a filename.
3. LaTeX writes `_openleaf_entry.tex` and invokes Tectonic with `--synctex --keep-logs --print` and, when requested, `--only-cached`.
4. Typst invokes the pinned Typst CLI directly against the selected `.typ` main document with short diagnostics and an explicit PDF output path.
5. Markdown invokes Pandoc directly against `.md`/`.markdown`, with an explicit
   output path and `--pdf-engine=<absolute bundled Tectonic path>`. Pandoc's
   manual explicitly supports a full PDF-engine path. Do not replace this with
   an implicit system `pdflatex`, since packaged OpenLeaf must not depend on an
   undeclared TeX installation. The process runs with the project root as its
   working directory so relative images, bibliography files, and CSL files work
   for both root and nested main documents.

Tauri's [sidecar documentation](https://v2.tauri.app/develop/sidecar/) defines
`bundle.externalBin` inputs with target-triple suffixes and exposes the packaged
sidecar under its unsuffixed name at runtime. OpenLeaf's Pandoc adapter resolves
that packaged Tectonic executable beside the application executable, matching
Tauri's desktop bundle layout. Unit tests cover macOS app-bundle and Cargo
debug/release candidates, while the release workflow inspects the staged
unsuffixed sibling on every target.

Tectonic 0.16.9 release archives are checksum-pinned from the official GitHub
Releases API `digest` fields. `scripts/fetch-tectonic.sh` verifies SHA256 before
extracting exactly the root `tectonic`/`tectonic.exe` regular-file member. The
same script is used by CI and every release target, including Windows.
6. All engines stream normalized log/error events. Rust returns compile metadata through JSON IPC. The PDF itself is fetched separately as raw binary IPC rather than embedded as base64 in the result.
7. The frontend renders PDF bytes with pdf.js and publishes normalized diagnostics to CodeMirror.

Engine descriptors model compilation policy plus formatting/source-preflight
profiles and feature/export/template-kind sets. Frontend consumers use the
fail-closed files-store descriptor rather than guessing from extensions. See
the [document engine matrix](document-engines.md).

Typst currently reports `supports_synctex=false`, `supports_offline=false`, and
`supports_isolated_compile=false`. Consequently reverse/forward search, the
offline compiler toggle, and LaTeX/TikZ figure generation are hidden or
normalized off for Typst projects. Add such behavior only after the backend
engine capability becomes truthful. Do not add extension-based UI exceptions.

## Where state lives

- Config: `~/.openleaf/config.json` (`0600` on Unix). Non-secret preferences
  live here. GitHub credentials use the OS keychain when available and
  fall back to the owner-only config file when it is not.
- Projects: `~/.openleaf/projects/<id>/`, plain folders with `.git`.
- App log: `~/.openleaf/app.log`.

## Key extension points

- Add an AI provider → `packages/ai-core/src/providers.ts` (`PROVIDERS` + `buildModel`). OpenAI-compatible providers just need a `baseURL`.
- Add a Tauri command → declare in `src-tauri/src/*.rs`, register in `src-tauri/src/lib.rs`, wrap in `src/lib/tauri.ts`.
- Add a document engine → implement `DocumentEngine` in `src-tauri/src/document_engine.rs`, expose truthful capabilities, add a checksum-pinned sidecar fetch/smoke path, then consume the descriptor in UI controls.
- Add a project template → drop a folder with a `template.json` manifest into `src-tauri/resources/templates/` (engine-general template metadata remains planned work).
- Add a tool for the AI → `packages/ai-tools/src/tools.ts`; app services it needs go through `AiToolsHost` (adapter in `src/lib/ai-tools.ts`).
- Add a rail tab / palette or omnibar command / AI toolset → register it in `src/contributions/` (see [Frontend architecture](architecture.md#the-contribution-registry)).

## Sync and GitHub internals

OAuth device flow runs server-side in Rust (`src-tauri/src/github.rs`) because the OAuth endpoints aren't CORS-enabled. The API calls (api.github.com) happen from the frontend.

## Coding style

- TypeScript: follow what's already there. No comments unless asked. Respect `noUnusedLocals`/`noUnusedParameters`.
- Rust: idiomatic, small commands, friendly error strings.
- UI: Tailwind v4 + Geist tokens; reuse the `Button`/`Tooltip`/`Select` primitives.

## Releasing

Packaging and signing are still being set up. The goal is a notarized `.dmg` (macOS), signed `.msi`/`.exe` (Windows x64), and `.AppImage`/`.deb` (Linux), each with matching Tectonic and Typst sidecars fetched and smoke-tested in CI.
