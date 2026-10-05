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
          "flags": ["--color", "--creation-timestamp", "--deps", "--features", "--font-path", "--format", "--ignore-system-fonts", "--input", "--package-cache-path", "--package-path", "--pages", "--pdf-standard", "--ppi"],
          "outputFormats": ["html", "pdf", "png", "svg"],
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
- `--pages` is proven by exporting only page 2 of a two-page document.
- `--creation-timestamp` is proven with the value `0`.
- `--deps` is proven by writing a JSON dependency list with
  `--deps-format json` and finding `main.typ` among its inputs. Typst 0.12
  and 0.13 only have the older `--make-deps`, which the app does not use.
- `--features` and the `html` output format are proven together by
  `--features html --format html`. The probe document has no page set rule,
  because Typst 0.13 refuses page settings in HTML export.

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
| `--pages 2` | no | yes | yes | yes | yes | yes |
| `--creation-timestamp 0` | no | yes | yes | yes | yes | yes |
| `--deps <file> --deps-format json` | no | no | no | yes | yes | yes |
| `--features html --format html` | no | no | yes | yes | yes | yes |

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
- The desktop app and the `oleafly` command-line tool read the copy compiled
  into `oleafly-core` (`TypstToolchainCatalog::embedded`). The next section
  describes what they do with it.

## Version management

The app fetches nothing about versions at run time. It reads the compiled-in
catalog and downloads only the binaries the catalog pins.

### Where a Typst comes from

A Typst version can come from three places.

The built-in one is the `typst` sidecar that ships with the app, at the version
in `typst.bundled`.

A downloaded one is a curated version installed from Settings > Engines >
Typst. It lives in `<data root>/toolchains/typst/<version>/typst[.exe]`. The
data root is `$OLEAFLY_DATA_DIR`, or `~/.oleafly` when that is unset.

A system one is a `typst` already on this computer. The app looks in each
`PATH` folder, then in `/opt/homebrew/bin` and `/usr/local/bin` (not on
Windows), then in `~/.cargo/bin`. It takes the first one that answers
`typst --version` within 5 seconds with a version it can read. The bundled
sidecar and anything under `<data root>/toolchains` never count. The answer is
cached for 30 seconds, and opening Settings checks again.

Settings lists every curated version and the system version, newest first,
with the release date, the download size, where each one is installed and the
Tinymist it uses.

To find a version, the app tries the built-in sidecar, then a verified
download, then the system Typst, and takes the first whose version matches
exactly. A system Typst is used only for the version it reports, never in
place of another one.

### Downloads and verification

An install takes the catalog artifact for the host target and works through
these steps:

1. It tries `mirrorUrl` first and `githubUrl` second. A network or checksum
   failure moves on to the next address. A local file error or a cancel stops
   at once.
2. It talks only HTTPS, to a host in `allowedDownloadHosts`, with no
   credentials in the address. Each redirect (at most 10) and the final address
   are checked against the same list.
3. `Content-Length` must equal `archiveSize`. Reading stops past that size, and
   the streamed SHA-256 must equal `archiveSha256`.
4. Only `archiveMember` is extracted. Links, special files, unsafe paths,
   repeated members and archives with more than 10,000 members are refused.
   The extracted file must match `binarySize` and `binarySha256`.
5. The work happens in `<data root>/toolchains/typst/.staging/<version>-<random>/`,
   and the finished folder is renamed into place. An install it replaces is
   kept aside until the rename succeeds.

A download gives up after 20 seconds without a connection, 30 seconds without
new data, or 30 minutes in total. One Typst install runs at a time, and a lock
file in `.staging` stops two Oleafly windows from installing the same version.
A failed or cancelled install leaves nothing behind. Staging folders left by an
interrupted install are removed the next time that version installs.

After the install the app checks the binary again and writes the result to
`installed.json` next to it: file name, SHA-256, size and modification time.
Later checks trust that record while the size and modification time are
unchanged, and hash the file again otherwise.

While a Typst install runs, quitting asks first and the app updater waits.
Removing a version deletes its folder. The default version cannot be removed.

### The default version

The default version is the one new Typst projects pin, and the one a project
without a pin compiles with. It is `typst_default_version` in the app config,
chosen with the radio buttons in Settings. With nothing chosen, the default is
the built-in version. Only an installed version can become the default.

### Per-project pins

A Typst project records its version in `project.json`:

```json
{ "engine": "typst", "main_doc": "main.typ", "typst": { "version": "0.13.1" } }
```

New Typst projects, projects made from templates, imports and linked folders
get the current default as their pin. Changing the default later does not move
them. The Compile options menu has a "Typst version (this project)" group to
pick another version, or "Default" to clear the pin. A pin must name a curated
version, the built-in version or the system version. It is a version, not a
path, so it stays valid when the project moves.

To test before changing a pin, "Try a newer version" in Settings > Engines >
Typst builds the open project with the current version and a newer installed
one, in temporary folders. It compares the page counts and the errors and
warnings, and can switch the pin.

### A pin this computer does not have

The app does not start Typst for a project whose pinned version is missing.
The compile reports that the version is not installed, and the preview offers
two buttons:

- "Download Typst X" appears when X is in the catalog. It installs X and
  compiles again.
- "Use Typst Y", where Y is the default version, clears the pin and compiles
  again.

The Compile options menu marks the pin as not installed.

### Tinymist for each minor

Each Typst minor has its own Tinymist, listed in the table at the top. A
project uses the Tinymist for its pin, or for the default version when it has
no pin. A Typst version outside the catalog gets the newest Tinymist whose
minor is not newer than its own, or the oldest one when none is.

The bundled Tinymist serves the bundled minor. For any other minor the app
downloads the catalog Tinymist the first time a project needs it, with the
same checks as a Typst download, into
`<data root>/toolchains/tinymist/<version>/`. The download starts by itself
when such a project opens. The language server waits for it, and the status
says that Tinymist is downloading. A failed download is tried again later.

These Tinymist downloads run in the background. Quitting does not ask about
them: it cancels them and removes their partial files. They never hold up an
app update.

Removing a downloaded Typst also removes the Tinymist for its minor, unless
another installed Typst (downloaded, built in or system) or the default
version still needs it. When Settings > Engines > Typst finds Tinymist builds
that no installed Typst minor needs, it offers "Remove unused language server
downloads".

Tinymist options depend on the Tinymist version. Every Tinymist starts with
`exportPdf: "never"` and `compileStatus: "disable"` and gets the formatter and
lint settings. Older builds do not know some keys, so
`src/lib/analysis/tinymist-compat.ts` leaves out `formatterIndentSize` below
Tinymist 0.12 and `lint` below 0.13. Changing the project's Typst minor, the
lint setting or package vendoring restarts the server. Source and PDF sync
needs Tinymist 0.13.30 or later, so it works for projects on Typst 0.13 and
newer.

### Packages

Every project and every Typst version share one set of package folders:

- `<data root>/typst/packages` holds `@local` packages.
- `<data root>/typst/packages-cache` caches downloaded `@preview` packages.

The app passes them with `--package-path` and `--package-cache-path` when the
version accepts those flags (0.12 and later, see the capabilities table). It
always sets `TYPST_PACKAGE_PATH` and `TYPST_PACKAGE_CACHE_PATH` too, and
Tinymist gets the same variables. In offline mode the proxy variables point at
an address that never answers, so Typst cannot download anything and packages
must already be cached or vendored.

Vendoring copies a project's packages into the project folder, so it no
longer depends on the shared cache. "Vendor packages into project" in the Typst packages dialog works
in three steps:

1. It compiles the main document once against the shared folders, which fills
   the cache.
2. It collects the packages in use: the `--deps` output on Typst 0.14 and
   later, the package names written in the project's `.typ` files, and the
   imports inside those packages.
3. It copies each one into `typst-packages/<namespace>/<name>/<version>` and
   sets `typst.vendor_packages` in `project.json`.

With vendoring on, `typst-packages/` becomes the package path, so vendored
copies come first. A package that was not vendored still resolves through the
shared cache. The dialog lists packages it could not find. Compile once while
online, then vendor again.

### Fonts, inputs and reproducible builds

These `typst` fields in `project.json` change how the app compiles. Each is
left out of the file while it has its default value.

| Field | Default | Effect |
| --- | --- | --- |
| `font_paths` | `[]` | Extra font folders, relative to the project. Folders outside the project are ignored. The project's `fonts/` folder is always passed when it exists. |
| `system_fonts` | `true` | `false` passes `--ignore-system-fonts` on Typst 0.12 and later. |
| `reproducible` | `false` | `true` also ignores system fonts and fixes the PDF date with `--creation-timestamp` (Typst 0.12 and later) and `SOURCE_DATE_EPOCH`. The date is the last commit when the project is a Git repository, else 0. |
| `inputs` | `{}` | Passed to every compile as `--input key=value`. |
| `variants` | `{}` | Named sets of inputs, as `{"camera-ready": {"inputs": {"anonymous": "false"}}}`. A variant's inputs override `inputs`. |

The Fonts and Build groups of the compile menu set `system_fonts` and
`reproducible`. The variant in use is a per-computer choice made in the compile
menu and is not saved in `project.json`. Variants themselves are edited in
Document settings. Tinymist gets the same font folders through its
`fontPaths` setting and `systemFonts: false` when system fonts are off, so the
editor and the compiler find the same fonts. The font picker in Document
settings runs `typst fonts` with the same folders. On Typst 0.15 and later it
adds `--variants`, which also reports where each font comes from.

When a folder opened in place compiles with Typst 0.14 or later, the app adds
`--deps <build>/_oleafly_entry.deps.json --deps-format json`. Checkpoints read
that list the way they read latexmk's `.fls` file, so files the compile read
are kept even where the folder's skip list would leave them out.

### Auto compile

Auto compile is one setting for every project. In a Typst project it keeps
`typst watch` running instead of compiling on a timer. The open file saves
150 ms after you stop typing, Typst compiles, and the preview reloads at the
same scroll position. LaTeX and Markdown projects still compile a few seconds
after typing stops. Stop compilation ends the watch process, and the next edit
starts it again.

### Exports

The Export menu offers PNG and SVG pages and HTML for Typst projects. PNG takes
a resolution, and both image formats take a page range (`--pages`, Typst 0.12
and later). Each page becomes its own file, numbered after the name you pick.
HTML uses `--features html` and is marked experimental. Export preparation
offers the PDF/A and PDF/UA standards the project's Typst version lists, and
writes them with `--pdf-standard`. Typst 0.14 and later tag every PDF, so
there is no separate tagged compile.

Word, HTML, Markdown, plain text, LaTeX and EPUB exports from a Typst project
first compile the document to HTML with Typst 0.13 or later, then convert that
HTML with pandoc. When Typst cannot write the HTML, or the version is older,
the export falls back to pandoc's Typst reader.

### The command-line tool

The `oleafly` command-line tool (`crates/oleafly-cli`) reads the pin and the
other `typst` settings from the folder's `project.json`. A folder linked into
the app without its own `project.json` uses the settings the app saved for it.
Only Typst projects use a pin.

It looks for Typst in this order:

1. `OLEAFLY_TYPST`.
2. Versions the app downloaded, under the same data root.
3. The `typst` next to the CLI, which in an app install is the bundled one.
4. `typst` on `PATH`.

A pinned project builds with the first Typst that reports the pinned version,
and uses that version's catalog capabilities. If `OLEAFLY_TYPST` points at a
different version, or nothing matches, the build stops before Typst runs. The
message says to install the version in Oleafly or to point `OLEAFLY_TYPST` at a
matching binary. An unpinned project uses `OLEAFLY_TYPST`, the bundled Typst or
`PATH`, in that order, and does not read the app's default version. The CLI
runs `typst --version` on that binary and uses the capabilities of the version
it reports.

`oleafly build` and `oleafly watch` compile with the same settings as the app.
The shared package folders under the data root go to `--package-path` and
`--package-cache-path`. With `typst.vendor_packages` on, `typst-packages/` in
the project is the package path instead. `TYPST_PACKAGE_PATH` and
`TYPST_PACKAGE_CACHE_PATH` are always set to the same folders. The project's
`fonts/` folder and each `typst.font_paths` folder go to `--font-path`, and
`system_fonts: false` adds `--ignore-system-fonts`. Each entry in
`typst.inputs` becomes `--input key=value`.

`--variant <name>` picks a set from `typst.variants`. Its inputs replace the
ones with the same key. A name the project does not define stops the command
with exit code 3, and the message lists the variants the project has. Other
engines ignore `--variant` and print a note that says so.

With `typst.reproducible` on, the CLI also ignores system fonts and passes
`--creation-timestamp` with the time of the last commit, or 0 when the folder
is not a Git repository. `SOURCE_DATE_EPOCH` gets the same value. Like the app,
it reads the commit time only when the project folder itself holds `.git`.

`--offline` works for Typst the way offline mode works in the app. The proxy
variables point at an address that never answers, so a download fails at once.
Packages already in the cache or in `typst-packages/` still resolve.

The CLI never passes a flag that the Typst version lacks (see the capabilities
table). When a setting cannot apply, the build prints one note for it:

```text
note: Typst 0.11.1 does not support --ignore-system-fonts, so typst.system_fonts is not applied
```

With `--json` the notes are left out, so stderr stays empty.

Builds use `--diagnostic-format human`, the format the app reads. In the JSON
output, each entry of `errors` has `file`, `line`, `column`, `message`, `kind`
and `hints`. Columns count from 1. An error raised inside a package points at
the line of the project that called it. Text mode streams Typst's own output to
stderr, with its hints and source lines.

A folder without `project.json` gets its main document by detection. Detection
skips a `typst-packages/` folder at the top of the project, because vendored
packages carry their own `template/main.typ`.

On a Typst project, `oleafly doctor` adds a `typst_version` check and a table
of every Typst it found:

```text
PASS compiler_typst: /Users/ada/.oleafly/toolchains/typst/0.13.1/typst (Typst 0.13.1, downloaded)
PASS typst_version: This project pins Typst 0.13.1
Typst found:
  0.13.1       downloaded    /Users/ada/.oleafly/toolchains/typst/0.13.1/typst
  0.12.0       PATH          /opt/homebrew/bin/typst
```

When the pinned version is missing, the check reads
`FAIL typst_version: This project pins Typst 0.13.1, but no Typst 0.13.1 was found`
and the command exits with code 4. Without a pin it reads
`No Typst version is pinned, so builds use Typst <version>`.

Doctor then lists the settings a build would use:

```text
Typst settings:
  Version pin        0.13.1
  Vendored packages  on
  Package folder     /Users/ada/thesis/typst-packages
  Package cache      /Users/ada/.oleafly/typst/packages-cache
  Font folders       /Users/ada/thesis/fonts
  System fonts       ignored
  Reproducible       off
  Inputs             draft=true
  Variants           camera-ready (anonymous=false), review (anonymous=true)
```

`System fonts` reads `ignored` when `system_fonts` is false or `reproducible`
is on. A `typst_settings` warning names each setting the chosen Typst cannot
apply.

With `--json`, the output gains
`"typst": {"pinned": ..., "found": [...], "settings": {...}}`. Each entry of
`found` has `version`, `source` and `path`, and `source` is `override`,
`downloaded`, `bundled` or `system`. `settings` has `vendor_packages`,
`package_path`, `package_cache_path`, `font_dirs`, `system_fonts`,
`reproducible`, `inputs` and `variants`, which maps each variant name to its
inputs.

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
