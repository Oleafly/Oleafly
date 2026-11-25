# Oleafly No AI

An Oleafly fork with AI features removed.

This fork keeps the local document editor, LaTeX/Typst/Markdown compilation, PDF preview, notes, references, deterministic converters and human collaboration. It removes the assistant, inline AI, agents, AI providers and model downloads, MCP, research-task execution, AI generation and transcription, and usage/budget tracking. Scanned PDFs require an external OCR tool; text-based PDF import remains available.

[Download this fork](https://github.com/peplxx/oleafly-no-ai/releases) · [Upstream Oleafly](https://github.com/Oleafly/Oleafly)

The application checks **this repository's releases** for signed updates. It retains Oleafly's application identity and data directory, so it is intended to replace an existing installation. Existing documents and notes remain usable; retired AI settings are ignored.

## Following upstream

The fork is maintained with ordinary Git commits and merges. No source-rewriting transformation is applied during builds. An hourly GitHub Actions workflow processes stable upstream releases in order, starting with 0.4.13, verifies the merged tree, and builds signed releases for macOS, Windows and Linux.

Known AI modules remain deleted. Conflicts in shared code, failed tests or a failed release stop the pipeline. See [fork maintenance](fork/README.md) for setup, recovery and limitations.

## Development

Use Node.js 24, pnpm as pinned in `package.json`, and the Rust toolchain in `rust-toolchain.toml`.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
node scripts/no-ai/check.mjs
pnpm tauri dev
```

Native builds also need the platform prerequisites and bundled compiler sidecars used by the upstream [build instructions](CONTRIBUTING.md) and release workflow. The browser and collaboration server remain part of this repository.

Oleafly is copyright © Prajwal Murthy and contributors. This fork retains the original [AGPL-3.0 license](LICENSE) and third-party notices.
