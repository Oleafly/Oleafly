# Typst toolchain catalog

Oleafly pins the Typst releases it offers in
[`src-tauri/resources/typst-toolchain.json`](../src-tauri/resources/typst-toolchain.json).
The catalog names the bundled Typst, every other Typst version Settings may
offer, and the Tinymist release matched to each Typst minor. Every entry is
pinned by archive and extracted-binary SHA-256.

The catalog is generated. Do not edit it by hand: change the curated lists in
[`scripts/typst/build-toolchain-catalog.mjs`](../scripts/typst/build-toolchain-catalog.mjs)
and regenerate.

## Curated releases

| Typst | Released | Tinymist for that minor | Tinymist released |
| --- | --- | --- | --- |
| 0.11.1 | 2024-05-17 | 0.11.32 | 2024-10-09 |
| 0.12.0 | 2024-10-18 | 0.12.22 | 2025-02-23 |
| 0.13.1 | 2025-03-07 | 0.13.30 | 2025-10-27 |
| 0.14.2 | 2025-12-12 | 0.14.20 | 2026-06-15 |
| 0.15.0 | 2026-06-15 | 0.15.8 | 2026-09-08 |
| 0.15.1 (bundled) | 2026-07-17 | 0.15.8 (bundled) | 2026-09-08 |

Each Tinymist pin is the newest stable release in that minor line. The bundled
Tinymist must match the bundled Typst minor, and it must equal the Tinymist pin
in the [language-server manifest](language-server-toolchain.md). The catalog
test checks both.

## Schema

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-10-02",
  "supportedTargets": ["aarch64-apple-darwin", "aarch64-unknown-linux-gnu", "x86_64-unknown-linux-gnu", "x86_64-pc-windows-msvc"],
  "allowedDownloadHosts": ["mirrors.oleafly.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"],
  "typst": {
    "repository": "https://github.com/typst/typst",
    "bundled": "0.15.1",
    "versions": [
      {
        "version": "0.15.1",
        "tag": "v0.15.1",
        "minor": "0.15",
        "releasedAt": "2026-07-17",
        "capabilities": {
          "flags": ["--color", "--font-path", "--format", "--ignore-system-fonts", "--input", "--package-cache-path", "--package-path", "--pdf-standard", "--ppi"],
          "outputFormats": ["pdf", "png", "svg"],
          "pdfStandards": ["1.4", "1.5", "1.6", "1.7", "2.0", "a-1b", "a-1a", "a-2b", "a-2u", "a-2a", "a-3b", "a-3u", "a-3a", "a-4", "a-4f", "a-4e", "ua-1"]
        },
        "targets": {
          "aarch64-apple-darwin": {
            "asset": "typst-aarch64-apple-darwin.tar.xz",
            "archiveType": "tar.xz",
            "archiveMember": "typst-aarch64-apple-darwin/typst",
            "archiveSha256": "48f62ed034aa3a7978309579ac6ca00045e2ef0da73114e8af27cfd8e74dc05a",
            "archiveSize": 14438168,
            "binarySha256": "7c4a136b377f3689400afe37b4f0fe3528d50faaa55cbb1106ac8a128f86ba1a",
            "binarySize": 45029488,
            "mirrorUrl": "https://mirrors.oleafly.com/binaries/typst/0.15.1/typst-aarch64-apple-darwin.tar.xz",
            "githubUrl": "https://github.com/typst/typst/releases/download/v0.15.1/typst-aarch64-apple-darwin.tar.xz"
          }
        }
      }
    ]
  },
  "tinymist": {
    "repository": "https://github.com/Myriad-Dreamin/tinymist",
    "bundled": "0.15.8",
    "versions": [
      { "typstMinor": "0.15", "version": "0.15.8", "tag": "v0.15.8", "releasedAt": "2026-09-08", "targets": {} }
    ]
  }
}
```

The example shows one target. Real entries always list all four supported
targets, in the order of `supportedTargets`.

| Field | Meaning |
| --- | --- |
| `typst.versions[]`, `tinymist.versions[]` | Sorted oldest first. Versions are unique. |
| `typst.bundled` | The version shipped as the `typst` sidecar. Must be in `typst.versions`. |
| `tinymist.versions[].typstMinor` | The Typst minor this Tinymist serves. Every curated Typst minor has exactly one. |
| `releasedAt` | GitHub release publication date (UTC). |
| `asset` | The upstream release asset name. |
| `archiveType` | `tar.xz`, `tar.gz`, `zip`, or `binary` for a bare executable. |
| `archiveMember` | Path of the executable inside the archive, read from a real listing. `null` for `binary`. |
| `archiveSha256`, `archiveSize` | Digest and byte length of the downloaded asset. |
| `binarySha256`, `binarySize` | Digest and byte length of the extracted executable. Equal to the archive values for `binary`. |
| `mirrorUrl`, `githubUrl` | Download addresses. Try the mirror first and GitHub second. The hash pin keeps either origin honest. |

Linux targets use Typst's static `*-unknown-linux-musl` builds, the same
assets the bundled sidecar has always used. Tinymist Linux targets use its
`*-unknown-linux-gnu` archives, matching the language-server manifest.
Tinymist 0.11.32 published no archives, so its entries point at the bare
`tinymist-darwin-arm64`, `tinymist-linux-arm64`, `tinymist-linux-x64` and
`tinymist-win32-x64.exe` executables. The Tinymist Windows zip holds
`tinymist.exe` at its root; every other archive nests the executable in a
directory named after the asset.

Mirror paths follow the existing layouts:
`binaries/typst/<version>/<asset>` for Typst and
`language-servers/tinymist/<version>/<asset>` for Tinymist.

## Capabilities

`capabilities` records what each Typst version accepted when the generator ran
it. Each probe compiles a small document with the app's argument list plus one
extra flag, and only counts if a valid output file comes back. A flag missing
from `flags` means that version rejects it, so the app must not pass it.

- `--color` means the space-separated `--color never` form. Typst 0.11 and
  0.12 declare `--color[=<WHEN>]` with an optional value, so they read `never`
  as a subcommand and fail with `unrecognized subcommand 'never'`. The app and
  the CLI pass `--color=never`, which works with every curated version, and
  the generator uses it for every other probe.
- `--package-path` is proven by importing an `@local` package from that
  directory. `--package-cache-path` is proven by importing an `@preview`
  package from a pre-filled cache, so neither probe touches the network.
- `--input` is proven by reading the value back through `sys.inputs`.
- `--format` and `--ppi` are proven by an SVG export and a PNG export at 144
  PPI whose width is checked against the page size.
- `pdfStandards` lists the values `typst compile -h` offers for
  `--pdf-standard`. The generator also compiles with `--pdf-standard a-2b`.

Generation stops if any version fails the base compile, or if an invalid
document does not produce the `path:line:column: error:` line that the app's
diagnostic parser reads.

| Flag | 0.11.1 | 0.12.0 | 0.13.1 | 0.14.2 | 0.15.0 | 0.15.1 |
| --- | --- | --- | --- | --- | --- | --- |
| `--color never` | no | no | yes | yes | yes | yes |
| `--color=never` | yes | yes | yes | yes | yes | yes |
| `--font-path <dir>` | yes | yes | yes | yes | yes | yes |
| `--ignore-system-fonts` | no | yes | yes | yes | yes | yes |
| `--input k=v` | yes | yes | yes | yes | yes | yes |
| `--format svg` | yes | yes | yes | yes | yes | yes |
| `--format png --ppi 144` | yes | yes | yes | yes | yes | yes |
| `--pdf-standard a-2b` | no | yes | yes | yes | yes | yes |
| `--package-path <dir>` | no | yes | yes | yes | yes | yes |
| `--package-cache-path <dir>` | no | yes | yes | yes | yes | yes |

PDF standards: none on 0.11.1; `1.7` and `a-2b` on 0.12.0; `1.7`, `a-2b` and
`a-3b` on 0.13.1; seventeen values from `1.4` to `ua-1` on 0.14.2 and later.

## Regenerate and verify

```bash
# Rewrite the catalog from GitHub and run the host's binaries.
pnpm typst-toolchain:catalog

# Rebuild in memory and compare with the committed file. Never writes.
pnpm typst-toolchain:check

# Offline schema, script and manifest contract tests.
pnpm typst-toolchain:test
```

The generator:

1. reads each curated release from the GitHub Releases API and refuses drafts
   and prereleases;
2. downloads every target asset from GitHub, about 1 GB in total, and checks
   its byte length against the API;
3. checks the download against GitHub's published `digest` where one exists
   (Typst 0.14 and later, Tinymist 0.13 and later) and records the locally
   computed SHA-256 for older releases;
4. lists each archive, requires exactly one regular file named `typst[.exe]`
   or `tinymist[.exe]`, and hashes the extracted executable;
5. runs the current host's Typst and Tinymist executables from a temporary
   directory to record capabilities, check `--version`, and check that
   `tinymist lsp --help` works; and
6. writes keys in a fixed order, so unchanged inputs give a byte-identical
   file. `generatedAt` only moves when some other field changes.

Probing needs a host that is one of the four supported targets. Elsewhere, pass
`--skip-probe` to keep the committed capabilities. `tar` must be able to read
`xz` archives. Set `GITHUB_TOKEN` to avoid the anonymous API rate limit.

## Who reads the catalog

- `scripts/fetch-typst.sh`, `scripts/smoke-typst.sh` and
  `scripts/ensure-e2e-sidecars.sh` read the bundled pin through
  `node scripts/typst/bundled-typst.mjs version` and
  `node scripts/typst/bundled-typst.mjs target <triple>`. The second form
  prints `asset archiveType archiveMember archiveSha256 binarySha256 mirrorUrl githubUrl`
  on one line. `fetch-typst.sh` also checks the extracted executable against
  `binarySha256`.
- `scripts/ensure-e2e-sidecars.ps1` reads the same fields with
  `ConvertFrom-Json`, so it works under Windows PowerShell 5.1.

## Changing a pin

1. Edit `TYPST_VERSIONS`, `BUNDLED_TYPST_VERSION`, `TINYMIST_BY_TYPST_MINOR`
   or `BUNDLED_TINYMIST_VERSION` in the generator.
2. Run `pnpm typst-toolchain:catalog` and review the diff.
3. If the bundled Tinymist changed, update the
   [language-server manifest](language-server-toolchain.md#updating-a-pin) to
   the same release.
4. Upload any new asset to the mirror at its `mirrorUrl`. Until then, downloads
   fall back to GitHub.
5. Run `pnpm typst-toolchain:test` and `pnpm language-servers:test`.
