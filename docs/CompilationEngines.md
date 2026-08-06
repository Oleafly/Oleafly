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
  accessibility-oriented workflows; it is separate from the default Tectonic
  path.
- Import scan (`@oleafly/latex` `scanImportCompatibility`) flags Overleaf-style
  requirements (biblatex, minted, glossaries, shell-escape, fonts) when a
  project is opened. The same taxonomy (`IMPORT_COMPAT_CATALOG`) drives the
  compile-failure classifier (`classifyCompileFailure`) and the engine-picker
  modal, so every surface describes a gap in the same words.

## latexmk (full Overleaf parity)

Projects that need tools Tectonic does not orchestrate — `minted`
(shell-escape + Pygments), `glossaries`/`makeidx` (external index runs),
`pythontex`, shell-escape-heavy publisher classes — can pin the `latexmk`
engine instead. It drives a **system TeX distribution** (MacTeX, TeX Live,
MiKTeX, or TinyTeX) via `latexmk`, exactly the way Overleaf compiles.

- Detection is shared (`src-tauri/src/tex_distro.rs`): managed TinyTeX under
  `~/.oleafly/tinytex`, MacTeX, `/usr/local/texlive/<year>`, MiKTeX (Windows),
  and `~/.TinyTeX` are probed stat-only. The same list feeds the compile
  child's `PATH`.
- The underlying TeX engine is chosen from the source: a
  `% !TeX program = xelatex|lualatex|pdflatex` magic comment wins; fontspec /
  polyglossia / unicode-math force XeLaTeX; everything else uses pdfLaTeX
  (Overleaf's default).
- `-shell-escape` is enabled only when the source needs it (minted, pythontex,
  `\write18`, svg) — Overleaf runs sandboxed and enables it globally; a desktop
  app should not.
- latexmk runs the *real* main document with `-jobname=_oleafly_entry`, so all
  artifact paths (PDF, log, SyncTeX) match the Tectonic layout and the preview,
  log pane, and SyncTeX work unchanged.
- TinyTeX can be installed on demand (Settings → LaTeX Engine, or the
  engine-picker modal). The installer checks free disk space first, reports
  phased progress (download / unpack / packages), resumes interrupted
  downloads across launches, and intercepts app quit while running.

## Why `project.json` matters

`project.json` is the project's **portable contract**, and it is the reason two
people opening the same Oleafly project see the same output:

- `engine` pins how the project compiles (`xetex` = bundled Tectonic,
  `latexmk` = system TeX). A coauthor who clones the project compiles with the
  same engine automatically — the choice never lives only in one person's
  app settings (the Settings default applies to *new* projects only).
- `tex` (written when a project switches to latexmk) records the TeX
  distribution and the `tlmgr` package versions present when the pin was made
  — the `package-lock.json` role. On open, coauthors are prompted to install
  missing pinned packages, and a distribution mismatch (e.g. pinned
  "TeX Live 2025", local "MacTeX 2024") gets a heads-up that rendering may
  differ.
- `main_doc`, `name`, `color`, and export history ride along too.

It lives at the project **root** (not under `.oleafly/`) precisely so that git
and ZIP export carry it: the app-internal `.oleafly/` directory is gitignored
and skipped by exports by design. Do not move engine or pin data into
`.oleafly/` — coauthors would silently stop receiving it.

Every successful compile also writes a small provenance record to
`.oleafly/builds/` (engine, distribution, lockfile hash, output fingerprint;
local-only, pruned to the last 20) so "my coauthor's bibliography looks
different" is a diagnosable question — compare the two machines' latest build
records.
- **Supervised PATH:** every supervised compile child (LaTeX, Typst, Markdown
  tooling that goes through the same helper) gets TeX-related directories and the
  sidecar directory prepended to `PATH`. Non-LaTeX engines simply ignore unused
  entries; directories are only added when they exist on disk.
- **Linux aarch64:** upstream has no Biber 2.17 binary; packaging ships a stub
  that exits with a clear error so the bundler still has an `externalBin` file.

## Typst

- Uses the pinned Typst CLI.
- Supports `.typ` source and direct PDF output.
- Advertises current capability limits truthfully: SyncTeX, offline, and
  isolated-compile support are currently disabled.
- Typst-specific UI behavior is driven by the descriptor, not extensions.
- Receives the same supervised `PATH` prepending as LaTeX (see above); Typst
  does not use Biber or TeX Live bins.

## Markdown

- Uses Pandoc with the bundled Tectonic executable as its PDF engine.
- Supports `.md` and `.markdown` projects, structural indexing, citations,
  and conversion exports declared by the descriptor.
- Does not claim SyncTeX, offline compilation, or isolated figure support.
- Pandoc can be installed on demand; the app records a clear prerequisite state.

## Sidecar and supply-chain policy

- Tectonic, Typst, TexLab, and Tinymist versions are pinned by manifests or
  release metadata.
- Fetch scripts verify SHA-256 before extraction and reject unexpected archive
  members.
- Language servers are not silently packaged as Tauri external binaries;
  installation is consent-gated and license-aware.

## Engineering anchors

- `src-tauri/src/document_engine.rs`: descriptors and dispatch.
- `src-tauri/src/latex_engine.rs`: optional tagged LaTeX path.
- `scripts/fetch-tectonic.sh`, `scripts/fetch-typst.sh`, and
  `scripts/fetch-language-servers.mjs`: pinned acquisition.
- `docs/document-engines.md`: capability matrix and extension policy.
- `docs/language-server-toolchain.md`: language-server distribution policy.
