# Releasing Oleafly

## The one thing to understand

A release is triggered by pushing a **git tag** shaped like `vX.Y.Z`
(e.g. `v0.2.5`). That tag push starts the **Release** workflow
(`.github/workflows/release.yml`), which builds installers for macOS, Windows,
and Linux and creates a **draft** GitHub Release.

Pushing to `main` does **not** make a release. It only runs tests (CI).
Tag = release; branch = tests.

## Cutting a release

```sh
# 1. Be on an up-to-date main with green CI
git checkout main && git pull

# 2. Bump the version everywhere (package.json, tauri.conf.json, Cargo.toml, Cargo.lock)
./scripts/bump-version.sh 0.2.5

# 3. Commit the bump. Stage the files by name, never with -a, -A or "."
git status --short
git add CHANGELOG.md package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml Cargo.lock
git commit -m "chore: release v0.2.5"
git push

# 4. Tag it and push the tag: THIS triggers the build
git tag v0.2.5
git push origin v0.2.5
```

Then wait ~15-25 min. The workflow creates a **draft** release at
<https://github.com/Oleafly/Oleafly/releases>. Review the notes and the
attached files. To publish, re-run the Release workflow from the Actions tab
for the same tag with **Publish the release** checked. Nothing is public until
you publish.

## What version number?

Semantic versioning (`MAJOR.MINOR.PATCH`):

- **PATCH** (`0.1.0 → 0.1.1`): bug fixes only.
- **MINOR** (`0.1.0 → 0.2.0`): new features, backward-compatible.
- **MAJOR** (`0.1.0 → 1.0.0`): breaking changes, or the "it's ready" milestone.

## Manual alternative (no tag)

GitHub → **Actions** tab → **Release** → **Run workflow** → enter a tag
(e.g. `v0.2.5`). Same result, handy to re-run if a build failed.

## After publishing

Installed apps check `latest.json` on launch and offer the update. So the
in-app updater only *does* something once there are **two** published releases:
the version a user has installed, and a newer one to update to. Your first
release just establishes the baseline.

## Provenance and SBOMs

Every release build creates GitHub artifact attestations for the files uploaded
by Tauri and for the canonical `latest.json` updater manifest. It also attaches
one SPDX JSON software bill of materials (SBOM) for each supported build target:

- macOS Apple Silicon
- Linux x86_64
- Linux ARM64
- Windows x86_64

The workflow verifies the uploaded files against GitHub's attestation service
before a draft is marked complete. Missing SBOMs or invalid attestations keep
the release in draft state.

Anyone can independently verify a downloaded installer with the GitHub CLI:

```sh
gh attestation verify ./Oleafly-installer-file \
  --repo Oleafly/Oleafly \
  --signer-workflow Oleafly/Oleafly/.github/workflows/release.yml
```

To verify the installer's SPDX SBOM attestation as well:

```sh
gh attestation verify ./Oleafly-installer-file \
  --repo Oleafly/Oleafly \
  --signer-workflow Oleafly/Oleafly/.github/workflows/release.yml \
  --predicate-type https://spdx.dev/Document/v2.3
```

## Gotchas

- **The tag must match the manifests.** That's the whole job of
  `bump-version.sh`: run it, don't hand-edit versions.
- **Don't reuse a tag.** To redo `v0.2.5`: delete the remote tag
  (`git push origin :v0.2.5`), delete the draft release, then re-tag.
- **Windows builds are unsigned** until the Azure signing secrets are added,
  and users see a SmartScreen warning on first launch. macOS releases are
  code-signed and notarized. The **updater** artifacts are separately
  minisign-signed (repo secrets `TAURI_SIGNING_PRIVATE_KEY` +
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). See [signing.md](signing.md) and
  [updates.md](updates.md).
