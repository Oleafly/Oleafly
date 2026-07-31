# Auto-updates

Oleafly ships with an in-app updater (Tauri's `plugin-updater`). On launch it
quietly checks the latest GitHub Release; if a newer version is available it
opens a dedicated, branded update window (not a native OS dialog) that shows the
changelog and offers to download, verify, install, and restart. Users can also
trigger a check from **About → Check for updates** (which reports the result
inline), or on macOS and Linux from the **Oleafly → Check for Updates** menu.
That application menu (macOS and Linux only — Windows has no menu bar) also
offers **Reload Views** for refreshing webviews and **Restart Application** for
a full process restart.

Preview builds may be distributed without operating-system code signatures.
Updater artifacts are generated only when the release workflow has access to
the updater-signing private key. Update failure handling remains available when
an installed build cannot use the signed feed.

## How it works

1. The release workflow builds signed **updater artifacts** and a `latest.json`
   manifest for the GitHub Release when its signing secrets are configured.
2. The app fetches `latest.json` from the release's
   `.../releases/latest/download/latest.json` endpoint (see the `plugins.updater`
   block in `tauri.conf.json`).
3. Before installing, the downloaded bundle's **minisign signature** is verified
   against the public key embedded in `tauri.conf.json`. An unsigned or
   tampered artifact is rejected.

The update window renders the release notes as formatted markdown. Those notes
come from the version's `CHANGELOG.md` section: `release.yml` runs
`scripts/changelog-extract.sh <version>` to build the release body (what
changed, with install help as a link rather than the headline), and
tauri-action copies that body into `latest.json`'s `notes`, which the window
displays.

## One-time maintainer setup (required)

The updater public key is committed in `src-tauri/tauri.conf.json`
(`plugins.updater.pubkey`). The matching private key must remain in a secure
password manager or CI secret store. It must never be committed, copied into
this repository, or pasted into an issue, chat, shell history, or log.

Configure the following GitHub Actions secrets through the repository's secret
management UI (or an equivalent approved secret-management workflow):

- `TAURI_SIGNING_PRIVATE_KEY`: the complete private signing key value.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the key password, if one is configured.

The release workflow passes these values to `tauri-apps/tauri-action`. Do not
document local key paths or secret values. Keep a documented owner and rotation
procedure in the team's private operations runbook.

## Cutting a release

1. Update `CHANGELOG.md`: rename the top `## [Unreleased]` section to the new
   `## [X.Y.Z]` heading and add a fresh empty `## [Unreleased]` above it. The
   release notes are generated from this section, so the heading must match the
   tag (minus the `v`).
2. Bump the version, commit, and tag:

```sh
scripts/bump-version.sh 0.2.2   # keeps package.json / Cargo.toml / tauri.conf.json / Cargo.lock in sync
git commit -am "chore: release v0.2.2"
git tag v0.2.2 && git push origin main --tags   # triggers the Release workflow
```

The workflow builds every platform, signs the updater artifacts, generates
`latest.json`, and creates a **draft** release. Publish it once the artifacts
look right. Installed apps will pick up the update on their next launch.

## Failure and rollback

A failed update check or download leaves the installed application unchanged
and can be retried from About or the application menu. Signature verification
failure blocks installation. The application restarts only after
`downloadAndInstall` completes successfully.

Oleafly does not provide automatic rollback after a successful update. To
return to an earlier version, close Oleafly, download the earlier official
installer, verify its checksum, and install it over the current version. Back
up important projects before changing application versions.

## Security notes

- **Never commit the private key** or paste it anywhere public. If it leaks,
  generate a new pair (`pnpm tauri signer generate -w <secure-path>`), replace
  the `pubkey` in `tauri.conf.json`, and update the CI secrets. Existing installs
  can only auto-update to releases signed by the key matching their embedded
  public key, so a rotation requires users on the old key to update once
  manually.
- Keep the private key protected by the organization's approved secret-storage
  and access-control policy. The repository documents the secret names only,
  never their values or local storage paths.
- macOS/Windows **code signing** (Gatekeeper/SmartScreen) is a separate concern
  from updater signing and is still TODO.
