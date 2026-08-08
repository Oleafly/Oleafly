# Language-server toolchain

Oleafly pins language-server release archives in
[`scripts/language-servers/manifest.json`](../scripts/language-servers/manifest.json).
The manifest is the only source of download URLs, target mappings, archive
members, checksums, extracted-binary hashes, runtime LSP profiles, and
distribution policy. Rust, TypeScript, and the process smoke must consume the
same `servers.*.lsp` object instead of reconstructing server-specific values.

## Pinned servers

| Server | Version | License | Default policy | LSP command |
| --- | --- | --- | --- | --- |
| [TexLab](https://github.com/latex-lsp/texlab) | 5.26.0 | GPL-3.0-only | Consent-gated app-data download | `texlab run` |
| [Tinymist](https://github.com/Myriad-Dreamin/tinymist) | 0.15.2 | Apache-2.0 | Bundled archive, verified app-data install | `tinymist lsp` |

The target allowlist matches Oleafly's existing sidecar tooling:

- `aarch64-apple-darwin`
- `aarch64-unknown-linux-gnu`
- `x86_64-unknown-linux-gnu`
- `x86_64-pc-windows-msvc`

Production releases currently build macOS arm64, Linux x64, and Windows x64.
Linux arm64 remains in the fetch allowlist for CI and supported development
hosts.

## Authoritative runtime profiles

Each profile declares the process arguments, initialization options, and the
optional `workspace/didChangeConfiguration` payload sent after `initialized`.
The pinned profiles intentionally prevent a document-analysis session from
also producing build artifacts:

```json
{
  "texlab": {
    "args": ["run"],
    "initializationOptions": {},
    "didChangeConfiguration": {
      "settings": {
        "texlab": {
          "build": {
            "onSave": false
          }
        }
      }
    }
  },
  "tinymist": {
    "args": ["lsp"],
    "initializationOptions": {
      "exportPdf": "never",
      "compileStatus": "disable"
    },
    "didChangeConfiguration": null
  }
}
```

`pnpm language-servers:test` checks the complete object shape and exact values.
An unknown, missing, or differently typed profile must fail closed.

## User-consent setup and retry

TexLab is not part of an Oleafly installer or release artifact. When LaTeX
language support is requested and the pinned executable is absent, the app
must show TexLab's name and version, its
[GPL-3.0-only license](https://github.com/latex-lsp/texlab/blob/v5.26.0/LICENSE),
the [pinned corresponding source](https://github.com/latex-lsp/texlab/tree/v5.26.0),
the download purpose, and its app-data destination. The download may begin
only after an explicit user action.

A declined, interrupted, or failed setup remains unavailable without a
background retry. The UI may offer Retry, which is another explicit user
action and repeats the same checksum-pinned flow. A successful retry replaces
only a verified regular file in the application data directory.

The installer and runtime use Tauri's identifier-scoped app-local-data base:

| Platform | App-local-data language-server directory |
| --- | --- |
| macOS | `~/Library/Application Support/com.oleafly.app/language-servers` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/com.oleafly.app/language-servers` |
| Windows | `%LOCALAPPDATA%\com.oleafly.app\language-servers` |

Within that directory, each executable path is versioned and target-specific:

```text
texlab/5.26.0/<target>/texlab[.exe]
tinymist/0.15.2/<target>/tinymist[.exe]
```

For example, the Apple Silicon path ends in
`texlab/5.26.0/aarch64-apple-darwin/texlab`. This is the same layout used by
the Rust first-run installer and launcher, so a developer fetch is immediately
visible to the application.

For development and isolated tests,
`OLEAFLY_LANGUAGE_SERVER_APP_DATA_DIR` replaces the identifier-scoped app-data
base. The `language-servers` child is still appended.

## Fetch and verify

Install the current host according to each server's manifest policy:

```bash
pnpm language-servers:fetch
pnpm language-servers:check
```

Running the developer fetch command is itself an explicit setup action. The
default stages Tinymist's exact upstream archive at its manifest-declared
`src-tauri/resources/language-servers/tinymist/0.15.2/<asset>` path and puts
TexLab in the current user's app-data directory described above. The Tinymist
archive, not its extracted executable, is the Tauri resource.

Verified release archives are cached separately under the ignored
`src-tauri/target/language-servers/archives` tree. Override only that archive
cache with `OLEAFLY_LANGUAGE_SERVER_CACHE_DIR`; doing so does not change the
runtime app-data destination.

Useful explicit modes:

```bash
# Verify the manifest and its integration contracts.
pnpm language-servers:test

# Install from an already verified archive without network access.
pnpm language-servers:fetch -- --offline

# Redownload the pinned current-host archives and replace current files.
pnpm language-servers:fetch -- --force

# Fetch one server for the current release target.
pnpm language-servers:fetch -- --server tinymist

# Explicitly select the app-data destination policy.
pnpm language-servers:fetch -- --server texlab --install-mode app-data

# Explicitly stage one target's immutable Tauri resource archive.
pnpm language-servers:fetch -- --server tinymist --install-mode resource
```

Resource mode deliberately rejects `--target all`: each application artifact
must contain exactly its own platform archive, never every supported platform.

`--check` is network-free. A normal fetch is also network-free when the
installed binary already matches its pinned size and SHA-256. If installation
is needed, a valid cached archive is reused before any request is made.

## Optional current-host diagnostics smoke

After fetching the current-host artifacts, run the opt-in process smoke:

```bash
pnpm language-servers:smoke

# Or exercise one server or a different workspace.
pnpm language-servers:smoke -- --server texlab
pnpm language-servers:smoke -- --server tinymist --workspace /absolute/project
```

For Tinymist, the smoke first verifies the staged archive's exact size and
SHA-256, securely extracts only the pinned regular-file member into a temporary
directory, verifies the executable's size and SHA-256, and then runs it. It
uses only the manifest's `lsp` object for process arguments, initialization,
and post-initialization configuration. It rapidly opens and replaces an
invalid document through seven monotonically versioned epochs, requires
diagnostics matching the final document, and observes the stream for a stale
regression after accepting that final epoch.

Each successful run emits a machine-readable `EVIDENCE` JSON line containing
wall-clock and monotonic send/receive timestamps, client epochs, optional
server document versions, diagnostic fingerprints, the accepted final
sequence, and the stale-regression count. Frontend policy tests can use those
fields to confirm that unversioned TexLab diagnostics still pass through the
client's current-epoch gate. This remains an opt-in real-process check:
`pnpm test` and normal builds do not require downloaded binaries or network.

`pnpm build` remains a frontend-only typecheck and Vite build. It never invokes
the language-server fetcher. A Tauri release stages one target-specific
Tinymist archive under `bundle.resources`; neither Tinymist nor TexLab appears
in `bundle.externalBin`. TexLab is deliberately absent, so normal release builds do not require or
package a TexLab binary.

## Download and extraction security

The fetcher:

1. accepts only a closed server and target allowlist;
2. starts from exact `https://github.com/.../releases/download/...` URLs;
3. follows at most five HTTPS redirects to an allowlisted GitHub asset host;
4. enforces the release asset's exact byte length and SHA-256 before parsing;
5. rejects absolute paths, parent traversal, backslashes, duplicate entries,
   links, unsupported entry types, encrypted ZIPs, and unexpected archive
   formats;
6. extracts only the exact manifest member in memory;
7. verifies the extracted binary's pinned byte length and SHA-256;
8. walks and `lstat`s every existing output ancestor from the filesystem root,
   rejecting links, non-directories, realpath changes, and Windows reparse
   points or ambiguous reparse queries;
9. creates missing directories one component at a time while rechecking parent
   identities;
10. opens regular inputs with `O_NOFOLLOW` where available and creates random
    same-directory temporary files with exclusive no-follow descriptors;
11. syncs and permissions the descriptor, then rechecks ancestor realpaths and
    device/inode identities immediately before and after the final rename; and
12. checks the reported version when the selected target is executable on the
    current host.

At runtime, Rust resolves Tinymist only through Tauri v2's documented
`BaseDirectory::Resource` API. It accepts no caller-provided path or environment
override, verifies every resource-root/path node is a real directory or regular
file rather than a symlink/reparse point, enforces lexical and canonical
containment, and rechecks the archive's exact size and SHA-256. It then repeats
the safe exact-member extraction and binary verification before publishing the
executable atomically to app-local-data. A corrupt regular install is repaired;
a missing or tampered resource and a linked path fail closed.

Bundling the immutable upstream archive instead of an executable also keeps the
integrity contract valid across macOS codesigning and Windows Authenticode:
signing may change executable bytes, while the archive remains byte-for-byte
equal to the pinned upstream release object.

Archive checksums come from the official GitHub Releases API `digest` fields.
Tinymist also publishes matching `.sha256` release assets. Extracted-binary
hashes were derived only after the corresponding official archive digest was
verified.

## License and distribution status

> [!WARNING]
> TexLab bundle redistribution is blocked pending an explicit maintainer
> compliance decision. Oleafly has no technical bundle override, and this
> document does not provide legal advice or approval to publish a bundle.

### TexLab 5.26.0

TexLab's pinned
[`Cargo.toml`](https://github.com/latex-lsp/texlab/blob/v5.26.0/Cargo.toml)
declares `GPL-3.0`, and its pinned
[`LICENSE`](https://github.com/latex-lsp/texlab/blob/v5.26.0/LICENSE) contains
GPL version 3 without an “or later” grant. The manifest therefore records
`GPL-3.0-only`.

GPLv3 section 13 expressly permits combining GPLv3-covered work with
AGPLv3-covered work. That compatibility statement does not by itself satisfy
object-code distribution duties. Before Oleafly publishes a TexLab binary, the
release owner must choose and implement a GPLv3 section 6 conveyance method,
provide the complete GPLv3 license, preserve copyright/license/no-warranty
notices, and make the corresponding source available as that method requires.
The pinned source is:

- <https://github.com/latex-lsp/texlab/tree/v5.26.0>
- <https://github.com/latex-lsp/texlab/archive/refs/tags/v5.26.0.tar.gz>

The upstream repository has no `NOTICE` file at the pinned tag. This does not
remove the GPL license, notice, or source obligations.

The manifest therefore sets:

- `defaultPolicy: app-data-download`
- `runtimeLocation: app-data`
- `requiresUserConsent: true`
- `redistributionApproved: false`
- `bundleStatus: blocked-pending-maintainer-approval`

`src-tauri/tauri.conf.json` therefore has no TexLab `externalBin`. Release
automation must not fetch TexLab into `src-tauri/binaries` or add it to a
bundle. Changing that policy requires a separate, explicit maintainer decision
plus implemented and reviewed source, license, and notice conveyance. Merely
changing the manifest boolean is insufficient.

### Tinymist 0.15.2

Tinymist's pinned
[`Cargo.toml`](https://github.com/Myriad-Dreamin/tinymist/blob/v0.15.2/Cargo.toml)
declares `Apache-2.0`. Its pinned
[`LICENSE`](https://github.com/Myriad-Dreamin/tinymist/blob/v0.15.2/LICENSE)
includes the Apache License 2.0 and the copyright statement “Copyright
2023-2025 Myriad Dreamin, Nathan Varner.”

Redistribution must provide the Apache-2.0 license, retain applicable
copyright, patent, trademark, and attribution notices, and identify modified
upstream files if Oleafly ever distributes any. The upstream repository has no
`NOTICE` file at the pinned tag. The pinned source is:

- <https://github.com/Myriad-Dreamin/tinymist/tree/v0.15.2>
- <https://github.com/Myriad-Dreamin/tinymist/archive/refs/tags/v0.15.2.tar.gz>

Oleafly distributes the official unmodified release executable inside its
exact checksum-pinned upstream archive. The manifest marks archive bundling as
allowed only with these license notices preserved. Every application bundle
includes both the target-specific archive resource and the pinned upstream
license as
`resources/licenses/tinymist-0.15.2-LICENSE` (SHA-256
`a9f29769fd3a7ee2976e6e161a93e16461fa305c088c4806242e50ec8ef86bce`).
The pinned upstream tag has no `NOTICE` file, so Oleafly does not invent one.

The manifest therefore sets `tauriExternalBin: null`,
`defaultPolicy: resource-archive`, and
`runtimeLocation: app-data-from-resource`. Release automation stages the exact
archive declared by `targets.<triple>.resourceRelativePath` before invoking a
Tauri build and asserts that no sibling `tinymist[.exe]` external binary was
staged.

## Updating a pin

Do not edit only the version string. A pin update requires:

1. selecting a stable release from the official repository;
2. recording every allowlisted target's exact release asset, archive member,
   size, and SHA-256;
3. deriving the extracted binary size and SHA-256 from the verified archive;
4. revalidating the exact `lsp` runtime profile against pinned upstream source;
5. checking `--version`, CLI help, EOF behavior, and rapid-change final
   diagnostics on a supported host;
6. rechecking the pinned license, source tag, and upstream `NOTICE` status;
7. running `pnpm language-servers:test`; and
8. fetching, checking, and smoking the current host before release.

## Known gap: the bundled macOS Tinymist is pinned to ourselves

Apple's notary service unpacks archives inside the app bundle and validates
every Mach-O it finds. Upstream ships Tinymist unsigned, so notarizing a build
that carries the archive as-is fails outright:

    The binary is not signed with a valid Developer ID certificate.
    The signature does not include a secure timestamp.
    The executable does not have the hardened runtime enabled.

`scripts/sign-bundled-tinymist.mjs` therefore runs on the macOS release leg. It
verifies the staged archive against the upstream pin, extracts the binary, signs
it with our Developer ID under the hardened runtime with a secure timestamp,
rebuilds the archive with the same internal layout, and rewrites the manifest
entry to the digests of what we now ship.

**The gap.** After that rewrite, `archiveSha256` and `binarySha256` for
`aarch64-apple-darwin` describe our re-signed artifact, not upstream's published
one. The original digests are preserved as `upstreamArchiveSha256` and
`upstreamBinarySha256`, but nothing enforces them past the signing step, so the
supply-chain guarantee for that one target is weaker than for the others: the
bundled copy is verified against ourselves.

The signing script does check the staged bytes against the upstream pin before
touching them, so an archive that never matched upstream cannot be laundered
into a signed bundle. What is missing is enforcement *after* re-signing.

**The fix worth doing.** Carry both digests as first-class manifest fields and
verify each where it belongs - the download against upstream, the bundled copy
against the re-signed hash - rather than overwriting one with the other. That
keeps upstream verification intact end to end and removes the asymmetry between
macOS and the other targets.
