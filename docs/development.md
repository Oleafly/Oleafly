# Development

What you need to work on Oleafly. The app is a [Tauri 2](https://tauri.app) project: a React + TypeScript + Vite frontend that talks over IPC to a Rust backend. Rust selects a compiler through the `DocumentEngine` interface. LaTeX and Typst use shipped CLI sidecars. Markdown uses a discovered or on-demand Pandoc executable with the shipped Tectonic executable as Pandoc's PDF engine.

## Repo layout

```
oleafly-desktop/
├── crates/
│   ├── oleafly-core/       shared Rust project, path, build, and process policy
│   ├── oleafly-cli/        oleaflyc command-line adapter
│   └── oleafly-agent/      provider-neutral agent runtime
├── src/                    React app shell (stores, Tauri client, UI kit, port adapters)
│   ├── components/         ui (shadcn-style), layout, editor glue, preview panes, ai
│   ├── contributions/      registers rail tabs / commands / AI toolsets into the registry
│   ├── features/           compile, synctex, export
│   ├── lib/                tauri wrappers, github, spellcheck, utils, package shims
│   └── store/              zustand stores
├── packages/               @oleafly/* engine packages (consumed as TS source)
│   ├── latex/  ai-core/  registry/  preflight/
│   └── editor/  preview/  diagram/  ai-tools/  templates/
├── src-tauri/
│   ├── src/                rust: commands, DocumentEngine, config, git, paths, project, synctex
│   ├── binaries/           target-suffixed compiler sidecars
│   ├── resources/          templates, licenses, and pinned runtime archives
│   └── tauri.conf.json
├── scripts/fetch-tectonic.sh
├── scripts/fetch-biber.sh
├── scripts/fetch-typst.sh
├── scripts/fetch-language-servers.mjs
└── docs/
```

The frontend is a pnpm workspace: feature engines live in `packages/*` behind
injected ports, and the app shell wires them together. Read
[Architecture](architecture.md) before touching `packages/`: it
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
./scripts/fetch-biber.sh all        # pinned Biber 2.17 (biblatex / tectonic-biber)
./scripts/fetch-typst.sh all
pnpm install
pnpm language-servers:fetch         # current-host policy, see note below
pnpm tauri dev
```

For a single platform, pass the same host triple to both fetch scripts (use `rustc -vV` to find it).

TexLab and Tinymist use the separate checksum-pinned language-server fetcher.
Its default installs TexLab under the current user's app-data directory as an
explicit development setup action and stages Tinymist's exact upstream archive
as a Tauri resource. Neither language server is an `externalBin`: TexLab's
GPL object-distribution checklist awaits a
separate maintainer decision, and normal Tauri release builds neither require
nor package it. The app's first-run path must display the pinned license/source
and wait for user consent before downloading. See
[Language-server toolchain](language-server-toolchain.md). `pnpm build` does
not fetch or require any sidecar.

## Day-to-day

```bash
pnpm tauri dev          # run the app with hot reload (frontend) + cargo incremental (backend)
pnpm build              # typecheck + build the frontend (tsc -b && vite build)
pnpm tauri build        # produce a distributable bundle
```

The command-line adapter is source-only for now. Run it from the workspace:

```bash
cargo run -p oleafly-cli --bin oleaflyc -- --help
cargo run -p oleafly-cli --bin oleaflyc -- init
cargo run -p oleafly-cli --bin oleaflyc -- build
cargo run -p oleafly-cli --bin oleaflyc -- project info --json
```

`oleaflyc` uses the current directory unless `-C <path>` is provided. It also
supports `watch`, `clean`, and `doctor`. Human-readable output is the default;
`--json` provides structured output, and watch mode emits newline-delimited
JSON events.

### Checks before opening a PR

Make sure both pass:

```bash
pnpm build                                # frontend typecheck (noUnusedLocals/Parameters on)
pnpm test                                 # vitest across src/ and packages/
pnpm language-servers:test                # manifest, checksum, target, URL, and license policy
pnpm audit --prod --audit-level high      # registry-backed npm advisory check
cargo check --workspace                   # all Rust crates compile
cargo test -p oleafly-core -p oleafly-cli --all-targets  # shared core and CLI
cargo deny --manifest-path src-tauri/Cargo.toml check  # workspace advisories, licenses, and sources
```

The two audit commands require registry/network access. CI records their
current results on every code change. An offline local run cannot certify that
the dependency graph is advisory-free.

For user-facing changes, also run the end-to-end suite (real app and real
compiles, see [e2e/README.md](../e2e/README.md)):

```bash
pnpm test:e2e:app                         # builds + launches the app, runs Playwright, tears down
```

## How a compile works

1. The frontend loads the backend `project_engine` descriptor and its capability flags, then calls `compileProject(projectId, mainDoc, offline)` through Tauri IPC.
2. `oleafly-core` validates the workspace, resolves the source inside the project root, and prepares the isolated build directory.
3. The desktop adapter dispatches through `DocumentEngine`. UI code must not infer engine behavior from a filename. The `oleaflyc` adapter invokes its native compiler runner through the same shared workspace policy.
4. LaTeX writes `_oleafly_entry.tex` and invokes Tectonic with `--synctex --keep-logs --print` and, when requested, `--only-cached`.
5. Typst invokes the pinned Typst CLI directly against the selected `.typ` main document with short diagnostics and an explicit PDF output path.
6. Markdown invokes Pandoc directly against `.md`/`.markdown`, with an explicit
   output path and `--pdf-engine=<absolute bundled Tectonic path>`. Pandoc's
   manual explicitly supports a full PDF-engine path. Do not replace this with
   an implicit system `pdflatex`, since packaged Oleafly must not depend on an
   undeclared TeX installation. The process runs with the project root as its
   working directory so relative images, bibliography files, and CSL files work
   for both root and nested main documents.

Tauri's [sidecar documentation](https://v2.tauri.app/develop/sidecar/) defines
`bundle.externalBin` inputs with target-triple suffixes and exposes the packaged
sidecar under its unsuffixed name at runtime. Oleafly's Pandoc adapter resolves
that packaged Tectonic executable beside the application executable, matching
Tauri's desktop bundle layout. Unit tests cover macOS app-bundle and Cargo
debug/release candidates, while the release workflow inspects the staged
unsuffixed sibling on every target.

Tectonic 0.16.9 release archives are checksum-pinned from the official GitHub
Releases API `digest` fields. `scripts/fetch-tectonic.sh` verifies SHA256 before
extracting exactly the root `tectonic`/`tectonic.exe` regular-file member. The
same script is used by CI and every release target, including Windows.

TexLab 5.26.0 and Tinymist 0.15.2 have a separate machine-readable manifest,
secure Node fetcher, and distribution policy. Neither language server is a
Tauri `externalBin`. TexLab resolves from its consent-gated, checksum-pinned
app-local-data installation. Tinymist's target-specific upstream archive is a
Tauri resource. Rust verifies and extracts it atomically into the same
versioned app-local-data layout on first use. Keeping the archive immutable is
important because macOS and Windows signing may modify executable bytes. See
[Language-server toolchain](language-server-toolchain.md) for the target
matrix, integrity checks, CLI modes, and license obligations.
7. All engines stream normalized log/error events. Rust returns compile metadata through JSON IPC. The PDF itself is fetched separately as raw binary IPC rather than embedded as base64 in the result.
8. The frontend renders PDF bytes with pdf.js and publishes normalized diagnostics to CodeMirror.

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

Oleafly stores app-managed state beneath the user's `~/.oleafly/` directory.
The application keeps preferences separate from owner-only encrypted
credentials. Do not copy, publish, or commit files from this directory. The
directory also contains project folders (each with its own `.git` repository)
and the application log. Exact credential filenames and key material are
intentionally omitted from public documentation.

## Key extension points

- Add an AI provider → `crates/oleafly-agent/src/provider.rs` (`CATALOG` + `wire_for`), and mirror the display entry in `packages/ai-core/src/providers.ts` (`PROVIDERS`). OpenAI-compatible providers just need a `base_url`, since routing collapses to three wire formats.
- Add a Tauri command → declare in `src-tauri/src/*.rs`, register in `src-tauri/src/lib.rs`, wrap in `src/lib/tauri.ts`.
- Add a document engine → implement `DocumentEngine` in `src-tauri/src/document_engine.rs`, expose truthful capabilities, add a checksum-pinned sidecar fetch/smoke path, then consume the descriptor in UI controls.
- Add a project template → drop a folder with a `template.json` manifest into `src-tauri/resources/templates/` (engine-general template metadata remains planned work).
- Add a tool for the AI → `packages/ai-tools/src/tools.ts`. App services it needs go through `AiToolsHost` (adapter in `src/lib/ai-tools.ts`).
- Add a rail tab / palette or omnibar command / AI toolset → register it in `src/contributions/` (see [Architecture](architecture.md#the-contribution-registry)).

## Sync and GitHub internals

OAuth device flow runs server-side in Rust (`src-tauri/src/github.rs`) because the OAuth endpoints aren't CORS-enabled. The API calls (api.github.com) happen from the frontend.

## Coding style

- TypeScript: follow what's already there. No comments unless asked. Respect `noUnusedLocals`/`noUnusedParameters`.
- Rust: idiomatic, small commands, friendly error strings.
- UI: Tailwind v4 + Geist tokens. Reuse the `Button`/`Tooltip`/`Select` primitives.
- User-facing copy: prefer short sentences. Do not use em dashes or semicolons
  in labels, status text, errors, accessibility text, tool descriptions, or AI
  prompts. Syntax examples and source-language snippets are exempt.

## Releasing

Packaging targets macOS Apple Silicon, Windows x64, Linux x64, and Linux ARM64.
Each target gets matching Tectonic, Biber, Typst, and language-server resources
that are fetched and smoke-tested in CI. A tag produces a complete draft.
Publishing is a separate manual workflow run and is blocked until the live
Anthropic and Google real-app contracts pass. See [Auto-updates](updates.md)
for required secrets, optional model variables, signing, and publication.
