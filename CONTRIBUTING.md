# Contributing to Oleafly

Thanks for wanting to make Oleafly better! This guide gets you from a fresh
clone to a working dev build, and covers how we review and land changes.

## Ways to contribute

- Report a bug: open a [bug report](https://github.com/Oleafly/Oleafly/issues/new/choose).
- Request a feature: open a [feature request](https://github.com/Oleafly/Oleafly/issues/new/choose).
- Report a vulnerability: please do not open a public issue; see [SECURITY.md](SECURITY.md).
- Send a pull request: see below.

For anything larger than a small fix, open an issue first so we can agree on the
approach before you invest time.

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| [Node.js](https://nodejs.org) | 22.13+ | Required by pnpm 11 |
| [pnpm](https://pnpm.io) | 11.9+ | Enable Corepack or install the version declared in `package.json` |
| [Rust](https://rustup.rs) | stable (1.77+) | includes `cargo` |
| Platform deps | - | See the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS (on Linux: `libwebkit2gtk-4.1-dev`, `librsvg2-dev`, `patchelf`, …) |

## Getting started

```bash
git clone https://github.com/Oleafly/Oleafly.git
cd Oleafly
pnpm install

# Find your target with `rustc -vV | grep host`.
bash scripts/fetch-tectonic.sh aarch64-apple-darwin   # or your host triple
bash scripts/fetch-typst.sh aarch64-apple-darwin

# Run the app in dev mode (hot-reloads the frontend, rebuilds Rust on change):
pnpm tauri dev
```

Interactive development uses `~/.oleafly-dev` by default, so reset and seed
tools cannot touch the library used by an installed Oleafly app. Set
`OLEAFLY_DATA_DIR` explicitly when you need a different isolated test library.

> The Tectonic and Typst binaries are **git-ignored** on
> purpose - never commit them. The fetch script drops them in
> `src-tauri/binaries/`, which is where `bundle.externalBin` expects them.

### Building a production bundle locally

```bash
pnpm tauri build
```

Installers land in `src-tauri/target/release/bundle/`.

## Project layout

```
crates/oleafly-core/  shared Rust project, path, and build-directory policy
crates/oleafly-cli/   oleaflyc commands and native compiler adapter
crates/oleafly-agent/ provider-neutral agent runtime
src/                 React + TypeScript frontend
  components/         UI (editor, pdf, ai, layout, files, …)
  lib/               framework-agnostic helpers (ai-providers, github, …)
  store/             Zustand state slices
src-tauri/src/       Rust backend (Tauri commands)
  commands.rs        compile pipeline (Tectonic sidecar)
  project.rs         project/file CRUD (path-sandboxed - see `resolve`)
  git.rs             git integration
  github.rs          GitHub OAuth device flow
  paths.rs           path helpers + project-id validation
docs/                public engineering and product documentation
scripts/             tooling (Tectonic fetch, icon gen)
```

Start with the [documentation index](docs/README.md). Feature inventories in
that index describe product behavior and implementation boundaries; the
lowercase engineering references contain deeper contracts and release policy.

## Tests

```bash
pnpm test                    # frontend unit tests (Vitest)
cargo test --workspace --all-targets  # Rust workspace tests
```

On Windows, run the Rust tests as
`OLEAFLY_EMBED_TEST_MANIFEST=1 cargo test --workspace --lib` (PowerShell:
`$env:OLEAFLY_EMBED_TEST_MANIFEST="1"`). The variable makes the build script
link a Common Controls v6 manifest into test binaries; without it they exit
with `STATUS_ENTRYPOINT_NOT_FOUND` before running, because only the packaged
app binary receives the manifest that Tauri normally embeds. Leave the
variable unset for `cargo build` and `pnpm tauri` commands so the app binary
keeps its single embedded manifest.

The ACP protocol tests also need Python 3 on `PATH` (`python.exe` on Windows,
`python3` on Unix). On Windows without Developer Mode, tests that require
creating symbolic links report that the session lacks that permission.

### Windows native and compiler checks

`powershell -File scripts/e2e.ps1` drives the real WebView2 app, with one
temporary library shared across fresh app launches. To test bundled frontend
assets instead of the Vite development server:

```powershell
$env:VITE_E2E_HOOKS = "1"
pnpm tauri build --debug --features e2e-testing --no-bundle
Remove-Item Env:VITE_E2E_HOOKS
$env:OLEAFLY_E2E_APP_BINARY = (Resolve-Path src-tauri/target/debug/oleafly.exe).Path
powershell -File scripts/e2e.ps1
Remove-Item Env:OLEAFLY_E2E_APP_BINARY
```

This binary contains test hooks and must not be distributed. The packaged
runner explicitly lists the three browser harness specs that require Vite;
run those separately in development mode. Live provider tests are opt-in
through the variables in `e2e/.env.example`. Keep credentials outside Git.
Use `--from-spec=<filename>.spec.ts` to resume the Windows sweep at an exact
spec filename; the runner first creates the shared document in a fresh library.

For the browser harnesses, start Vite with `OLEAFLY_E2E_DISABLE_HMR=1`
(PowerShell: `$env:OLEAFLY_E2E_DISABLE_HMR="1"; pnpm dev`). This also disables
HMR sockets in PDF module workers, avoiding a Playwright Firefox transport
assertion before selection tests can run. Normal development keeps HMR on.
The Windows native E2E runner sets this flag automatically for its dev server.

The standalone compiler matrix checks valid PDFs, included source files,
math, references, font selection, and errors without touching user projects:

```powershell
node scripts/smoke-document-engines.mjs
# Optionally include installed TeX Live engines:
$env:OLEAFLY_TEX_BIN_DIR = "C:/path/to/TinyTeX/bin/windows"
node scripts/smoke-document-engines.mjs
```

It always checks the bundled Tectonic and Typst sidecars; setting the TeX
directory adds pdfLaTeX, XeLaTeX, and LuaLaTeX. Logs and source fixtures are
preserved in the temporary directory printed at completion. Run performance
checks separately from builds and broad test suites to avoid measuring CPU
and disk contention.

Backend logic that touches the filesystem, git, or user paths **must** have a
test. The path-sandboxing helpers (`resolve_within`, `validate_project_id`) and
log/URL parsers are covered in `#[cfg(test)]` modules - extend them when you
change that code. On the frontend, the LaTeX masking that decides what the
spell/grammar checker sees is pure and unit-tested in
`src/components/editor/cm/latex-mask.test.ts` - add a case there when you change
what counts as prose.

## Code style

- **TypeScript** - the frontend must typecheck and build: `pnpm build`, and
  pass the Biome lint gate: `pnpm lint` (auto-fix what's safe with
  `pnpm lint:fix`). The gate **blocks** on correctness errors; an existing
  accessibility/style backlog is reported as non-blocking warnings (see
  `biome.json`). Prefer not adding new warnings.
- **Rust** - the backend must be `cargo fmt`-clean and `cargo clippy`-clean;
  both are **blocking** in CI (`clippy` runs with `-D warnings`). Run
  `cargo fmt --all` and `cargo clippy --workspace --all-targets -- -D warnings` before pushing.
- Match the surrounding code - comment density, naming, and idiom.

## Pull requests

1. Fork and branch from `main` (`git checkout -b fix/short-description`).
2. Keep the change focused; unrelated refactors belong in their own PR.
3. Make sure `pnpm lint`, `pnpm build`, and `cargo test --workspace --all-targets` pass locally.
4. Fill out the PR template - link the issue, describe the change, note how you
   tested it.
5. CI must be green (the frontend build and Rust tests are required checks).

We squash-merge, so a clean PR title is the commit message. Conventional-commit
style is appreciated but not required (e.g. `fix: reject absolute paths in resolve`).

## Releases (maintainers)

Releases are cut by pushing a version tag; the
[`Release` workflow](.github/workflows/release.yml) builds installers for macOS
(Apple Silicon), Windows x64, and Linux x64 and attaches them to a **draft**
GitHub Release for review before publishing.

```bash
# Bump the version everywhere it's declared (package.json, Cargo.toml,
# Cargo.lock, tauri.conf.json) in one shot, so the tag can't drift:
./scripts/bump-version.sh 0.2.0

git commit -am "chore: release v0.2.0"
git tag v0.2.0 && git push origin v0.2.0
```

By contributing, you agree that your contributions are licensed under the
project's [GNU Affero General Public License v3.0 or later](LICENSE).
