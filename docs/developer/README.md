# Developer documentation

[Back to Oleafly](../../README.md)

User guides live in the [Oleafly product docs](https://oleafly.com/docs/overview/).
The references below are for contributors, integrators, and release maintainers.

| Reference | Covers |
| --- | --- |
| [Engineering index](../README.md) | Feature inventories and engineering contracts |
| [Feature reference](../features.md) | The product surface and supported workflows |
| [Document engines](../document-engines.md) | LaTeX, Typst, and Markdown capabilities |
| [Product architecture](../architecture.md) | System boundaries, package ownership, and extension points |
| [Development](../development.md) | Local setup, tests, and contribution workflow |
| [Language-server toolchain](../language-server-toolchain.md) | Fetching, integrity, and distribution policy |
| [MCP integration](../mcp.md) | External clients, access tokens, and approval policies |
| [Releasing](../releasing.md) | Release workflow and artifact checks |
| [Code signing](../signing.md) | Platform signing requirements |
| [Auto-updates](../updates.md) | Update manifests, signatures, and rollback |

## Build from source

```bash
git clone https://github.com/Oleafly/Oleafly.git
cd Oleafly
pnpm install
host_target="$(rustc -vV | sed -n 's/^host: //p')"
./scripts/fetch-tectonic.sh "$host_target"
./scripts/fetch-biber.sh "$host_target"
./scripts/fetch-typst.sh "$host_target"
pnpm tauri dev
```

See the [development guide](../development.md) for prerequisites, platform
setup, production builds, and the source-only command-line workflow.

These scripts download the checksum-pinned compiler sidecars for your current
platform into `src-tauri/binaries`. The `all` argument is for CI and release
packaging, where every supported platform must be prepared.

Editor intelligence through TexLab and Tinymist is optional for a local run.
Fetch those language servers with `pnpm language-servers:fetch`. See the
[language-server toolchain](../language-server-toolchain.md) for its integrity,
licensing, and distribution policy.

### Command line

`oleaflyc` manages Oleafly projects without launching the desktop app. It
builds from source in this repository and is not published as a standalone
package yet.

```bash
cargo run -p oleafly-cli --bin oleaflyc -- init
cargo run -p oleafly-cli --bin oleaflyc -- doctor
cargo run -p oleafly-cli --bin oleaflyc -- build
cargo run -p oleafly-cli --bin oleaflyc -- watch
cargo run -p oleafly-cli --bin oleaflyc -- project info --json
```

Commands run against the current directory. Pass `-C <path>` to point at
another project. Run `oleaflyc --help` for the full command list.

## Contribute

Read the [contributing guide](../../CONTRIBUTING.md) for the development workflow,
code conventions, and required checks. Report security issues through the
[security policy](../../SECURITY.md).

## Credits

Oleafly builds on
[Tauri](https://tauri.app/),
[React](https://react.dev/),
[CodeMirror](https://codemirror.net/),
[Tectonic](https://tectonic-typesetting.github.io/),
[Typst](https://typst.app/),
[pdf.js](https://mozilla.github.io/pdf.js/),
[Zustand](https://github.com/pmndrs/zustand),
[Tailwind CSS](https://tailwindcss.com/),
[Harper](https://writewithharper.com/), and
[Hunspell](https://hunspell.github.io/).

Oleafly is licensed under
[AGPL-3.0-or-later](../../LICENSE). Third-party notices are listed in
[THIRD_PARTY_LICENSES.md](../../THIRD_PARTY_LICENSES.md).
