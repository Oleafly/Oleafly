# Auto-updates

OpenLeaf ships with an in-app updater (Tauri's `plugin-updater`). On launch it
quietly checks the latest GitHub Release; if a newer version is available it
offers to download, verify, install, and restart. Users can also trigger a check
manually from **About → Check for updates**.

## How it works

1. Each tagged release builds signed **updater artifacts** and a `latest.json`
   manifest, uploaded to the GitHub Release (`bundle.createUpdaterArtifacts` in
   `src-tauri/tauri.conf.json`).
2. The app fetches `latest.json` from the release's
   `.../releases/latest/download/latest.json` endpoint (see the `plugins.updater`
   block in `tauri.conf.json`).
3. Before installing, the downloaded bundle's **minisign signature** is verified
   against the public key embedded in `tauri.conf.json`. An unsigned or
   tampered artifact is rejected.

## One-time maintainer setup (required)

The signing **key pair** was generated already. The **public** key is committed
in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). The **private** key is
NOT in the repo. It lives at:

    ~/.openleaf-keys/openleaf-updater.key      (private, keep secret, 0600)
    ~/.openleaf-keys/openleaf-updater.key.pub  (public, already in the repo)

Add the private key to the repo's **GitHub Actions secrets** so the release
workflow can sign. From a machine with `gh` authenticated to the repo:

```sh
# The private key contents (this file is the whole secret):
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.openleaf-keys/openleaf-updater.key

# The key was generated WITHOUT a password, so set the password secret to empty:
printf '' | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

Or via the web UI: **Settings → Secrets and variables → Actions → New
repository secret**, names `TAURI_SIGNING_PRIVATE_KEY` (paste the full file
contents) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (leave empty).

That's it. `.github/workflows/release.yml` already passes both to
`tauri-apps/tauri-action`.

## Cutting a release

```sh
scripts/bump-version.sh 0.2.0   # keeps package.json / Cargo.toml / tauri.conf.json in sync
git tag v0.2.0 && git push origin v0.2.0
```

The workflow builds every platform, signs the updater artifacts, generates
`latest.json`, and creates a **draft** release. Publish it once the artifacts
look right. Installed apps will pick up the update on their next launch.

## Security notes

- **Never commit the private key** or paste it anywhere public. If it leaks,
  generate a new pair (`pnpm tauri signer generate -w <path>`), replace the
  `pubkey` in `tauri.conf.json`, and update the `TAURI_SIGNING_PRIVATE_KEY`
  secret. Existing installs can only auto-update to releases signed by the key
  matching their embedded public key, so a rotation requires users on the old
  key to update once manually.
- The key currently has **no password**. For extra defense-in-depth you can
  regenerate it with `-p <password>` and set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  to that value.
- macOS/Windows **code signing** (Gatekeeper/SmartScreen) is a separate concern
  from updater signing and is still TODO.
