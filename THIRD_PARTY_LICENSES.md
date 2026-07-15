# Third-Party Licenses

OpenLeaf is distributed under the [GNU AGPL v3 or later](LICENSE). It bundles
third-party open-source components, each under its own license, listed below.
The build accepts the licenses listed in `src-tauri/deny.toml`, including
permissive licenses and specifically reviewed licenses such as MPL-2.0.

This file lists the **direct** dependencies OpenLeaf ships. Their transitive
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

---

Attribution notices for OpenLeaf itself are in [NOTICE](NOTICE). If you
redistribute OpenLeaf or a derivative, keep this file and the notices it
references, per the terms of each component's license.
