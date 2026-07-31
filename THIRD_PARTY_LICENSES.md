# Third-Party Licenses

Oleafly is distributed under the [GNU AGPL v3 or later](LICENSE). It bundles
third-party open-source components, each under its own license, listed below.
The build accepts the licenses listed in `src-tauri/deny.toml`, including
permissive licenses and specifically reviewed licenses such as MPL-2.0.

This file lists the **direct** dependencies Oleafly ships. Their transitive
dependencies are checked by the automated license policy. The full, authoritative license
text for every JavaScript package is under `node_modules/<pkg>/LICENSE`, and for
every Rust crate under its source in the Cargo registry.

To regenerate a complete, transitive report:

```sh
pnpm licenses list --prod          # JavaScript / frontend
cargo install cargo-about && cargo about generate about.hbs   # Rust / backend
```

---

## Bundled binary

| Component | Purpose | License |
|---|---|---|
| [Tectonic](https://tectonic-typesetting.github.io/) | LaTeX compiler (sidecar) | MIT |
| [Typst](https://github.com/typst/typst) | Typst compiler 0.15.0 (sidecar) | Apache-2.0 |
| [Tinymist 0.15.2](https://github.com/Myriad-Dreamin/tinymist/tree/v0.15.2) | Typst language server (checksum-pinned upstream archive resource), © 2023–2025 Myriad Dreamin and Nathan Varner | Apache-2.0 |

The exact Tinymist 0.15.2 license is shipped in every application bundle at
`resources/licenses/tinymist-0.15.2-LICENSE`, alongside exactly one
target-specific unmodified release archive under
`resources/language-servers/tinymist/0.15.2/`. Upstream has no `NOTICE` file
at the pinned tag.

## Backend (Rust crates)

| Crate | License |
|---|---|
| tauri, tauri-build | Apache-2.0 OR MIT |
| tauri-plugin-shell / -dialog / -updater / -process | Apache-2.0 OR MIT |
| serde, serde_json | MIT OR Apache-2.0 |
| reqwest | MIT OR Apache-2.0 |
| base64 | MIT OR Apache-2.0 |
| flate2 | MIT OR Apache-2.0 |
| zip | MIT |

## Frontend (JavaScript / npm, bundled into the app)

| Package | License |
|---|---|
| @ai-sdk/anthropic, @ai-sdk/openai, @ai-sdk/react, ai | Apache-2.0 |
| @tauri-apps/api | Apache-2.0 OR MIT |
| @tauri-apps/plugin-dialog / -process / -shell / -updater | MIT OR Apache-2.0 |
| @codemirror/* (autocomplete, commands, lang-*, language, legacy-modes, lint, search, state, view) | MIT |
| @lezer/highlight | MIT |
| @replit/codemirror-vim | MIT |
| @radix-ui/react-context-menu / -select / -slot | MIT |
| react, react-dom | MIT |
| react-markdown, remark-gfm | MIT |
| react-resizable-panels | MIT |
| zustand | MIT |
| zod | MIT |
| katex | MIT |
| harper.js | Apache-2.0 |
| hunspell-asm | MIT |
| pdfjs-dist | Apache-2.0 |
| class-variance-authority | Apache-2.0 |
| clsx, tailwind-merge, cmdk | MIT |
| canvas-confetti | ISC |
| lucide-react | ISC |

## Fonts

| Font | Where | License |
|---|---|---|
| KaTeX fonts | math rendering (via `katex`) | MIT |
| Geist | UI typeface | SIL Open Font License 1.1 |

## Bundled data

| Data | Where | License |
|---|---|---|
| [LaTeX Workshop](https://github.com/James-Yu/LaTeX-Workshop) intellisense corpus (commit [`becabe2`](https://github.com/James-Yu/LaTeX-Workshop/tree/becabe238d3539105dd5bb9b7b3571d26e5d43e0)), © James Yu and LaTeX Workshop contributors | LaTeX completion data in `packages/latex-intelligence/data` | MIT |
| TeXStudio CWL completion files ([texstudio-org/texstudio](https://github.com/texstudio-org/texstudio/tree/master/completion)), via LaTeX Workshop | per-package/class catalogs `packages/latex-intelligence/data/packages/*.json` | as noted upstream |
| [CTAN](https://ctan.org/) package metadata, via LaTeX Workshop | package/class name lists in `packages/latex-intelligence/data` | as noted upstream |
| [unimathsymbols.txt](http://milde.users.sourceforge.net/LUCR/Math/), © 2011 Günter Milde, via LaTeX Workshop | `packages/latex-intelligence/data/unimath.json` | LPPL 1.3+ |

The corpus is regenerated from the pinned upstream commit by
`scripts/latex-intelligence-extract.mjs`; its exact provenance per file is
recorded in `packages/latex-intelligence/data/manifest.json`, and the upstream
third-party notices are reproduced verbatim in
`packages/latex-intelligence/data/UPSTREAM-NOTICES.md`.

---

Attribution notices for Oleafly itself are in [NOTICE](NOTICE). If you
redistribute Oleafly or a derivative, keep this file and the notices it
references, per the terms of each component's license.
