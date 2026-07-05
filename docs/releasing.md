# Releasing OpenLeaf

## The one thing to understand

A release is triggered by pushing a **git tag** shaped like `vX.Y.Z`
(e.g. `v0.1.1`). That tag push starts the **Release** workflow
(`.github/workflows/release.yml`), which builds installers for macOS, Windows,
and Linux and creates a **draft** GitHub Release.

Pushing to `main` does **not** make a release — it only runs tests (CI).
Tag = release; branch = tests.

## Cutting a release

```sh
# 1. Be on an up-to-date main with green CI
git checkout main && git pull

# 2. Bump the version everywhere (package.json, tauri.conf.json, Cargo.toml, Cargo.lock)
./scripts/bump-version.sh 0.1.1

# 3. Commit the bump
git commit -am "chore: release v0.1.1"
git push

# 4. Tag it and push the tag — THIS triggers the build
git tag v0.1.1
git push origin v0.1.1
```

Then wait ~15–25 min. The workflow creates a **draft** release at
<https://github.com/prajwal-svm/OpenLeaf/releases>. Review the notes and the
attached files, then click **Publish**. Nothing is public until you publish.

## What version number?

Semantic versioning — `MAJOR.MINOR.PATCH`:

- **PATCH** (`0.1.0 → 0.1.1`): bug fixes only.
- **MINOR** (`0.1.0 → 0.2.0`): new features, backward-compatible.
- **MAJOR** (`0.1.0 → 1.0.0`): breaking changes, or the "it's ready" milestone.

## Manual alternative (no tag)

GitHub → **Actions** tab → **Release** → **Run workflow** → enter a tag
(e.g. `v0.1.1`). Same result — handy to re-run if a build failed.

## After publishing

Installed apps check `latest.json` on launch and offer the update. So the
in-app updater only *does* something once there are **two** published releases:
the version a user has installed, and a newer one to update to. Your first
release just establishes the baseline.

## Gotchas

- **The tag must match the manifests.** That's the whole job of
  `bump-version.sh` — run it, don't hand-edit versions.
- **Don't reuse a tag.** To redo `v0.1.1`: delete the remote tag
  (`git push origin :v0.1.1`), delete the draft release, then re-tag.
- **Builds are unsigned** (macOS/Windows) until code-signing certs are added —
  users see a first-launch "unidentified developer" warning. The **updater**
  artifacts are separately minisign-signed (repo secrets
  `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`).
  See [updates.md](updates.md).
</content>
