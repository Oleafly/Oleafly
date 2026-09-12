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
| [Biber 2.17](https://sourceforge.net/projects/biblatex-biber/) | Bibliography backend for biblatex (`tectonic-biber` sidecar, version-pinned to Tectonic’s biblatex) | Artistic-2.0 / GPL-1.0-or-later |
| [Pandoc 3.9.0.2](https://github.com/jgm/pandoc/releases/tag/3.9.0.2) | Document converter (separate sidecar process) | GPL-2.0-or-later |
| [Typst](https://github.com/typst/typst) | Typst compiler 0.15.0 (sidecar) | Apache-2.0 |
| [Tinymist 0.15.2](https://github.com/Myriad-Dreamin/tinymist/tree/v0.15.2) | Typst language server (checksum-pinned upstream archive resource), © 2023–2025 Myriad Dreamin and Nathan Varner | Apache-2.0 |

Pandoc is an unmodified program that Oleafly starts as a separate process. Its
complete license is included at
`resources/licenses/pandoc-3.9.0.2-COPYING.md`. The corresponding source for
the exact bundled version is available from the
[3.9.0.2 source tag](https://github.com/jgm/pandoc/tree/3.9.0.2) and the
[source archive](https://github.com/jgm/pandoc/archive/refs/tags/3.9.0.2.tar.gz).
`scripts/fetch-pandoc.sh` downloads the release archive for each target and
checks it against these SHA-256 digests before extracting the executable:

| File | SHA-256 |
|---|---|
| `pandoc-3.9.0.2-arm64-macOS.zip` | `6e9eca844076bcbb599bbeebbba78a70f93b5307782b85c2c272872812c88875` |
| `pandoc-3.9.0.2-linux-arm64.tar.gz` | `b6d21e8f9c3b15744f5a7ab40248019157ed7793875dbe0383d4c82ff572b528` |
| `pandoc-3.9.0.2-linux-amd64.tar.gz` | `a69abfababda8a56969a254b09f9553a7be89ddec00d4e0fe9fd585d71a67508` |
| `pandoc-3.9.0.2-windows-x86_64.zip` | `c97542f2800f446e788d9f74237856d995421ad1bb3cc8324286840c5f272d3a` |
| `COPYING.md` (license text) | `9d56cac92294e206af026a5502bee0fed77200b08b51ec28aa63c9efda4dcfdd` |

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
| biblatex | MIT OR Apache-2.0 |
| statrs | MIT |
| rapidfuzz | MIT |
| zip | MIT |

## Frontend (JavaScript / npm, bundled into the app)

| Package | License |
|---|---|
| @ai-sdk/anthropic, @ai-sdk/openai, @ai-sdk/react, ai | Apache-2.0 |
| @tauri-apps/api | Apache-2.0 OR MIT |
| @tauri-apps/plugin-dialog / -process / -shell / -updater | MIT OR Apache-2.0 |
| @codemirror/* (autocomplete, commands, lang-*, language, legacy-modes, lint, search, state, view) | MIT |
| @lezer/highlight | MIT |
| @citation-js/core, @citation-js/plugin-bibtex, @citation-js/plugin-csl | MIT |
| @replit/codemirror-vim | MIT |
| @radix-ui/react-context-menu / -select / -slot | MIT |
| react, react-dom | MIT |
| react-markdown, remark-gfm | MIT |
| react-resizable-panels | MIT |
| zustand | MIT |
| zod | MIT |
| katex | MIT |
| mathjax-full | Apache-2.0 |
| xlsx (SheetJS) | Apache-2.0 |
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
| [unimathsymbols.txt](http://milde.users.sourceforge.net/LUCR/Math/), © 2011 Günter Milde | `public/latex-intelligence/unimath.json`, a modified form of that file | LPPL 1.3+ |
| [LaTeX Workshop](https://github.com/James-Yu/LaTeX-Workshop), © James Yu | compile-log parsers ported to TypeScript in `packages/latex/src/compile-log/` | MIT |
| [Citation Style Language styles](https://github.com/citation-style-language/styles) | eight bundled styles through Citation.js and `src/assets/csl/` | CC BY-SA 3.0 |

The LaTeX completion catalogs in `public/latex-intelligence` are generated by
`scripts/latex-corpus-build.mjs`, which reads each package's own source from a
TeX Live installation. They are our own output; `manifest.json` records the TeX
Live release they were built from.

---

Attribution notices for Oleafly itself are in [NOTICE](NOTICE). If you
redistribute Oleafly or a derivative, keep this file and the notices it
references, per the terms of each component's license.
