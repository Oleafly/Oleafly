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
  `scripts/fetch-biber.sh`), puts it on `PATH` for the compile child, and if a
  `.bcf` is left without a usable `.bbl`, runs that Biber explicitly and
  re-typesets once. This avoids GUI `PATH` misses and system-Biber version skew.
- Compile logs are normalized into editor diagnostics. Incomplete bibliography
  steps surface as `[Oleafly]` notes distinguishing “Biber not found” from
  “Biber/biblatex version mismatch”.
- Optional LuaLaTeX support can prepare and verify tagged PDF output for
  accessibility-oriented workflows; it is separate from the default Tectonic
  path.
- Import scan (`@oleafly/latex` `scanImportCompatibility`) flags Overleaf-style
  requirements (biblatex, minted, glossaries, shell-escape, fonts) when a
  project is opened.

## Typst

- Uses the pinned Typst CLI.
- Supports `.typ` source and direct PDF output.
- Advertises current capability limits truthfully: SyncTeX, offline, and
  isolated-compile support are currently disabled.
- Typst-specific UI behavior is driven by the descriptor, not extensions.

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
