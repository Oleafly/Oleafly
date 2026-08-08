# Compilation engines

Compilation is selected by a `DocumentEngine` descriptor. Frontend controls
consume the descriptor's capabilities instead of guessing from filename
extensions. Rust owns process execution, artifact paths, diagnostics, and
engine-specific policy.

## LaTeX

- Default engine: bundled Tectonic sidecar.
- Supports multi-file projects, images, bibliography files, SyncTeX, and
  cached/offline compilation when packages are available.
- **biblatex / Biber:** Tectonic 0.16 ships biblatex 3.17, which requires Biber
  2.17. Oleafly packages a pinned `tectonic-biber` sidecar (see
  `scripts/fetch-biber.sh`) and puts its directory on `PATH` for the compile
  child. **Primary path:** Tectonic discovers `tectonic-biber` mid-build and
  runs it itself. **Recovery path:** if a `.bcf` is left without a usable
  `.bbl` (PATH miss, mid-build tool failure), Oleafly runs the same sidecar via
  the supervised process helper (timeout + cancel) and re-typesets once. This
  avoids GUI `PATH` misses and system-Biber version skew.
- Compile logs are normalized into editor diagnostics. Incomplete bibliography
  steps surface as `[Oleafly]` notes distinguishing “Biber not found” from
  “Biber/biblatex version mismatch”.
- Optional LuaLaTeX support can prepare and verify tagged PDF output for
  accessibility-oriented workflows. It is separate from the default Tectonic
  path.
- Import scan (`@oleafly/latex` `scanImportCompatibility`) flags Overleaf-style
  requirements (biblatex, minted, glossaries, shell-escape, fonts) when a
  project is opened. The same taxonomy (`IMPORT_COMPAT_CATALOG`) drives the
  compile-failure classifier (`classifyCompileFailure`) and the engine-picker
  modal, so every surface describes a gap in the same words.

## latexmk (system TeX compatibility)

Projects that need tools Tectonic does not orchestrate, including `minted`
(shell-escape + Pygments), `glossaries`/`makeidx` (external index runs),
`pythontex`, and shell-escape-heavy publisher classes, can pin the `latexmk`
engine instead. It drives a **system TeX distribution** (MacTeX, TeX Live,
MiKTeX, or TinyTeX) via `latexmk` while preserving Oleafly's artifact layout.

- Detection is shared (`src-tauri/src/tex_distro.rs`). Full system
  distributions from standard locations and inherited `PATH` entries are
  ordered first only when the same binary directory contains `latexmk`,
  pdfLaTeX, XeLaTeX, LuaLaTeX, `kpsewhich`, and Biber. Managed TinyTeX under
  `~/.oleafly/tinytex` and user TinyTeX installations follow. Symlinks into
  TinyTeX remain in the TinyTeX tier. The same ordered list feeds tool lookup,
  Settings, and the compile child's `PATH`.
- The underlying TeX engine is chosen from the source: a
  `% !TeX program = xelatex|lualatex|pdflatex` magic comment wins. fontspec /
  polyglossia / unicode-math force XeLaTeX. Everything else uses pdfLaTeX
  (Overleaf's default).
- TeX shell commands are blocked by default. A user can explicitly allow them
  for one trusted project on one computer. The setting is never inferred from
  source, imported, exported, committed to Git, or stored in `project.json`.
  The local grant is bound to the project directory's filesystem identity, so
  copies and recreated project IDs require fresh consent. Leaving `latexmk` or
  deleting the project revokes it.
- System TeX is not a filesystem sandbox and may read files available to the
  user's account even while shell commands are blocked. Imported projects stay
  on bundled Tectonic until the user explicitly chooses system TeX.
- Project, user, and system `.latexmkrc` files are disabled because they are
  executable Perl. When local consent is enabled, Oleafly passes
  `-shell-escape` directly and supervises the resulting process tree. This can
  execute programs with the user's permissions and should be enabled only for
  fully trusted project files.
- PythonTeX uses an Oleafly-owned three-stage flow (latexmk, the active TeX
  distribution's `pythontex` helper, then latexmk) with bounded output,
  timeout, and cancellation. Unix uses an isolated process group. Windows
  creates the child suspended, assigns it to a kill-on-close Job Object, and
  resumes it only after containment succeeds. It is available only with the
  same explicit local consent.
- latexmk runs the *real* main document with `-jobname=_oleafly_entry`, so all
  artifact paths (PDF, log, SyncTeX) match the Tectonic layout and the preview,
  log pane, and SyncTeX work unchanged.
- TinyTeX can be installed on demand (Settings → LaTeX Engine, or the
  engine-picker modal). The installer checks free disk space first, reports
  phased progress (download / unpack / packages), resumes interrupted
  downloads across launches, and intercepts app quit while running. Before
  extraction it verifies the pinned archive byte length and SHA-256, then
  validates the exact reviewed member count, expanded size, member type and
  path manifest, duplicate-path policy, and confined symlink topology for the
  current platform. No member is written before that preflight succeeds.

## Why `project.json` matters

`project.json` is the project's **portable contract**, and it is the reason two
people opening the same Oleafly project see the same output:

- `engine` pins how the project compiles (`xetex` = bundled Tectonic,
  `latexmk` = system TeX). A coauthor who clones the project compiles with the
  same engine automatically. The choice never lives only in one person's
  app settings (the Settings default applies to *new* projects only).
- `tex` (written when a project switches to latexmk) records the TeX
  distribution and the `tlmgr` package versions present when the pin was made
  and fills the `package-lock.json` role. On open, coauthors are prompted to install
  missing pinned packages, and a distribution mismatch (e.g. pinned
  "TeX Live 2025", local "MacTeX 2024") gets a heads-up that rendering may
  differ.
- Permission to execute TeX shell commands is intentionally *not* part of this
  portable contract. Each computer requires a separate, explicit trust decision.
- `main_doc`, `name`, `color`, and export history ride along too.

It lives at the project **root** (not under `.oleafly/`) precisely so that git
and ZIP export carry it: the app-internal `.oleafly/` directory is gitignored
and skipped by exports by design. Do not move engine or pin data into
`.oleafly/` because coauthors would silently stop receiving it.

Every successful compile also writes a small provenance record to
`.oleafly/builds/` (engine, distribution, lockfile hash, and output fingerprint,
local-only, pruned to the last 20) so "my coauthor's bibliography looks
different" is a diagnosable question. Compare the two machines' latest build
records.
- **Supervised PATH:** every supervised compile child (LaTeX, Typst, Markdown
  tooling that goes through the same helper) gets TeX-related directories and the
  sidecar directory prepended to `PATH`. Non-LaTeX engines simply ignore unused
  entries. Directories are only added when they exist on disk.
- **Linux aarch64:** upstream has no Biber 2.17 binary. Packaging ships a stub
  that exits with a clear error so the bundler still has an `externalBin` file.

## Typst

- Uses the pinned Typst CLI.
- Supports `.typ` source and direct PDF output.
- Advertises current capability limits truthfully: SyncTeX, offline, and
  isolated-compile support are currently disabled.
- Typst-specific UI behavior is driven by the descriptor, not extensions.
- Receives the same supervised `PATH` prepending as LaTeX (see above). Typst
  does not use Biber or TeX Live bins.

## Markdown

- Uses Pandoc with the bundled Tectonic executable as its PDF engine.
- Supports `.md` and `.markdown` projects, structural indexing, citations,
  and conversion exports declared by the descriptor.
- Does not claim SyncTeX, offline compilation, or isolated figure support.
- Pandoc can be installed on demand. The app records a clear prerequisite state.

## Sidecar and supply-chain policy

- Tectonic, Typst, TexLab, and Tinymist versions are pinned by manifests or
  release metadata.
- Fetch scripts and runtime installers verify SHA-256 before extraction and
  reject unexpected archive members. TinyTeX pins a canonical manifest for
  Windows x64, macOS universal, Linux x64, and Linux ARM64 release assets.
- Language servers are not silently packaged as Tauri external binaries.
  installation is consent-gated and license-aware.

## Engineering anchors

- `src-tauri/src/document_engine.rs`: descriptors and dispatch.
- `src-tauri/src/latex_engine.rs`: optional tagged LaTeX path.
- `scripts/fetch-tectonic.sh`, `scripts/fetch-typst.sh`, and
  `scripts/fetch-language-servers.mjs`: pinned acquisition.
- `docs/document-engines.md`: capability matrix and extension policy.
- `docs/language-server-toolchain.md`: language-server distribution policy.
