# Compilation engines

Compilation is selected by a `DocumentEngine` descriptor. Frontend controls
consume the descriptor's capabilities instead of guessing from filename
extensions. Rust owns process execution, artifact paths, diagnostics, and
engine-specific policy.

<div align="center">
  <img src="assets/readme/compile-engines.png" alt="Oleafly Engines settings showing LaTeX, Typst, Markdown, and managed TeX distributions" width="100%" />
</div>
<p align="center"><em>Choose the engine that matches the document and its toolchain needs.</em></p>

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
- Import scan (`@oleafly/latex` `scanImportCompatibility`) flags the
  requirements of projects written for other LaTeX setups (biblatex, minted,
  glossaries, shell-escape, fonts) when a project is opened. The same taxonomy
  (`IMPORT_COMPAT_CATALOG`) drives the compile-failure classifier
  (`classifyCompileFailure`) and the engine-picker modal, so every surface
  describes a gap in the same words.
- Some findings come only from a failed compile, because nothing in the source
  predicts them: a class that pins hyperref's `pdftex` driver, an EPS figure
  the bundled engine cannot place, a `.sty` or `.cls` the bundled TeX bundle
  does not carry, and a failed bundle download. `importCompatAction` names the
  one fix each entry offers: switch to pdfLaTeX on system TeX and recompile,
  switch and then install the package, or just compile again. A failed download
  is reported on its own, never as a missing package.

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
- On macOS, TeX Live's Biber and the one in managed TinyTeX are universal
  binaries. Their PAR::Packer loader calls `lipo -extract_family` every time
  Biber starts. Recent Xcode's lipo rejects that flag, and a Mac without
  developer tools has no lipo at all, so Biber exits before it reads anything.
  Before a `latexmk` compile, Oleafly copies the slice for the Mac's CPU out of
  the universal file into `~/.oleafly/assets/biber/<fingerprint>/bin` (the same
  bytes `lipo -thin` would write) and puts that folder first on the child's
  `PATH`. The copy sits in that Biber's unpack folder, so pruning deletes it
  once TeX Live replaces the Biber. The `oleaflyc` CLI and `latexmk` runs from
  the in-app terminal don't get this yet.
- The TeX engine is set by "Compiler (this project)" in the compile menu,
  which saves the choice as `tex_flavor` in `project.json`. With Auto, the
  source decides: a `% !TeX program = xelatex|lualatex|pdflatex|uplatex|platex`
  magic comment wins. Japanese classes come next: `jsarticle`, `jsbook` and
  `jsreport` use pLaTeX, or upLaTeX with the `uplatex` option, the `uj*`
  classes and `jlreq` use upLaTeX, and the `ltj*` classes or `luatexja` use
  LuaLaTeX. The `ctex` classes and package and `xeCJK` use XeLaTeX.
  fontspec / polyglossia / unicode-math / `\setmainfont` force XeLaTeX.
  Everything else uses pdfLaTeX. The rules live in `oleafly-core`
  (`source_tex_flavor`), so `oleaflyc` picks the same compiler.
- upLaTeX and pLaTeX run through latexmk's DVI route (`-pdfdvi`) with
  `dvipdfmx`, `upbibtex` or `pbibtex`, and `upmendex` or `mendex`. These are
  passed on the command line because latexmk runs with `-norc`. If the
  compiler or `dvipdfmx` is missing next to latexmk, the compile stops with
  `tex.japanese_compiler_missing`, which names `tlmgr install
  collection-langjapanese`.
- Arbitrary TeX shell commands are blocked by default. A user can explicitly
  allow them for one trusted project on one computer. The setting is never
  inferred from source, imported, exported, committed to Git, or stored in
  `project.json`. The local grant is bound to the project directory's
  filesystem identity, so copies and recreated project IDs require fresh
  consent. Leaving `latexmk` or deleting the project revokes it.
- Without that consent, system TeX runs with restricted shell escape
  (`-shell-restricted`), not with shell escape switched off entirely. TeX Live
  then permits only the programs on its own allow list in `texmf.cnf`, such as
  `repstopdf`, `extractbb`, `kpsewhich`, and `makeindex`. That is what lets an
  ordinary imported project with EPS figures build on pdfLaTeX, because
  `epstopdf` can convert them during the run. MiKTeX does not accept that flag,
  so it keeps `-no-shell-escape`.
- System TeX is not a filesystem sandbox and may read files available to the
  user's account even while shell commands are blocked. A project runs system
  TeX only when someone chose it: the default compile engine in Settings >
  Engines, or the project's own engine choice. An opened folder stays on
  bundled Tectonic until it is trusted.
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
- TinyTeX can be installed on demand (Settings → Engines → Manage TeX
  distributions, or the engine-picker modal). The installer checks free disk
  space first, reports phased progress (download / unpack / packages), resumes
  interrupted downloads across launches, and intercepts app quit while
  running. Before extraction it verifies the pinned archive byte length and
  SHA-256, then validates the exact reviewed member count, expanded size,
  member type and path manifest, duplicate-path policy, and confined symlink
  topology for the current platform. No member is written before that
  preflight succeeds.
- Package lookups ask the local TeX Live database first and only fall back to
  the remote repository when the local answer is empty. A local release older
  than the remote one makes `tlmgr` refuse a remote query outright, and Oleafly
  names both years in the error instead of showing an empty result.
- A remote lookup that fails, or answers with something that is not JSON, is
  reported as a repository failure. It is never reported as a package TeX Live
  does not carry: that wording sends people back to their template for a file
  the mirror never answered about.
- When the system TeX tree is read only, an install retries in the personal
  tree. Its location comes from the active distribution
  (`kpsewhich --var-value=TEXMFHOME`), which answers `~/Library/texmf` on
  MacTeX and `~/texmf` on plain TeX Live, so the path is never guessed. If that
  tree has no package database yet, `tlmgr init-usertree` creates one first, and
  a failure there is reported as its own error. The result says where the
  packages landed.
- Settings reads both databases. The system list and
  `tlmgr --usermode list --only-installed` are merged, each row says which tree
  holds the package, and a removal goes to the tree the package came from.
- A package operation holds the compile locks while it runs, so the whole flow
  (search, tree setup, install, re-read) is capped at 15 minutes. Past that it
  is stopped and the error says so, instead of chaining per-command timeouts
  into most of an hour.
- On Windows, TeX Live installs `tlmgr` as `tlmgr.bat`, which `CreateProcessW`
  cannot start, so those calls go through `cmd.exe /D /V:OFF /C` with the path
  and every argument quoted. `/D` skips any AutoRun command and `/V:OFF` turns
  off delayed expansion, so an ambient shell setting cannot change what runs.

## Why `project.json` matters

`project.json` is the project's **portable contract**, and it is the reason two
people opening the same Oleafly project see the same output:

- `engine` pins how the project compiles (`xetex` = bundled Tectonic,
  `latexmk` = system TeX). A coauthor who clones the project compiles with the
  same engine automatically. The choice never lives only in one person's
  app settings. The Settings default is written into each project when it is
  created: a blank project, a template, an import (ZIP, folder, arXiv or
  GitHub), a converted document or a research project. An opened folder with
  no engine of its own follows the default once it is trusted. An imported
  project that pins pdfLaTeX, XeLaTeX, LuaLaTeX, upLaTeX or pLaTeX keeps that compiler when it
  lands on latexmk.
- `tex` (written when a project switches to latexmk or is created on it) records the TeX
  distribution and the `tlmgr` package versions present when the pin was made
  and fills the `package-lock.json` role. On open, coauthors are prompted to install
  missing pinned packages, and a distribution mismatch (e.g. pinned
  "TeX Live 2025", local "MacTeX 2024") gets a heads-up that rendering may
  differ.
- `typst` (Typst projects) pins the Typst version and stores its build
  settings: vendored packages, font folders, inputs, variants, and
  reproducible builds. See `docs/typst-toolchain.md`.
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

- Compiles with the Typst version the project pins, or with the default
  version from Settings → Engines → Typst. Oleafly ships one Typst and can
  download 0.11 to 0.15, each checked against a pinned checksum. See
  `docs/typst-toolchain.md`.
- Supports `.typ` source and direct PDF output.
- With Auto compile on, one `typst watch` process stays running and the
  preview refreshes as you type.
- Source and PDF sync goes through Tinymist and needs Typst 0.13 or newer.
  Offline mode works when packages are already cached or vendored into
  `typst-packages/`. Isolated compilation is not supported, so the figure tools
  render CeTZ or fletcher as Typst snippets.
- Typst-specific UI behavior is driven by the descriptor, not extensions.
- One-shot compiles receive the same supervised `PATH` prepending as LaTeX
  (see above). The `typst watch` process that Auto compile keeps running does
  not. Typst does not use Biber or TeX Live bins either way.

## Markdown

- Uses Pandoc with the bundled Tectonic executable as its PDF engine.
- Supports `.md` and `.markdown` projects, structural indexing, citations,
  and conversion exports declared by the descriptor.
- Does not claim SyncTeX, offline compilation, or isolated figure support.
- Packaged builds include Pandoc. The app records a clear prerequisite state,
  and Settings can repair a missing development copy.

## Sidecar and supply-chain policy

- Tectonic, Biber, Pandoc, Typst, TexLab, and Tinymist versions are pinned by
  manifests or release metadata.
- Fetch scripts and runtime installers verify SHA-256 before extraction and
  reject unexpected archive members. TinyTeX pins a canonical manifest naming
  the upstream assets it accepts: Windows x64, a universal macOS archive,
  Linux x64, and Linux ARM64. Those names describe TinyTeX's own downloads,
  not Oleafly's build targets. Oleafly releases macOS on Apple Silicon only,
  alongside Windows x64, Linux x64, and Linux ARM64.
- Language servers are not Tauri external binaries. Tinymist ships inside the
  app as a pinned archive, and the app checks it before installing it into
  app data. TexLab downloads only after the user agrees, and the prompt shows
  its license.

## Engineering anchors

- `src-tauri/src/document_engine.rs`: descriptors and dispatch.
- `src-tauri/src/latex_engine.rs`: optional tagged LaTeX path.
- `scripts/fetch-tectonic.sh`, `scripts/fetch-typst.sh`, and
  `scripts/fetch-language-servers.mjs`: pinned acquisition.
- `docs/document-engines.md`: capability matrix and extension policy.
- `docs/language-server-toolchain.md`: language-server distribution policy.
