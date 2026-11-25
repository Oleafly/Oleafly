# Maintaining the no-AI fork

## How updates work

`upstream-no-ai.yml` checks upstream each hour and processes the oldest missing stable semantic-version release. Prereleases and older maintenance branches are excluded. The first run builds the current 0.4.13 fork; subsequent releases are ordinary Git merges. This checkout started from upstream commit `185648311c07bb162a947f4157c3d499b4cfef64`, which is ahead of the `v0.4.13` tag; it is not an exact reconstruction of that tag.

1. Fetch the upstream release tag into a separate local ref.
2. Merge it into the fork. Only paths listed in `removed-paths.json` may automatically remain deleted. Shared-file conflicts fail the run.
3. Check the removal policy, updater identity, dependency lockfiles, frontend build/tests and native test compilation.
4. Atomically push the merge and a `vX.Y.Z-noai.1` tag without force-pushing.
5. Explicitly dispatch `release.yml`. GitHub does not trigger another workflow for a tag pushed with `GITHUB_TOKEN`, so this dispatch is necessary.
6. Build every platform, sign updater artifacts, verify the complete release, and publish `latest.json` in this repository. The next upstream merge waits for this release to be published.

`sync-upstream.py` orchestrates Git and GitHub operations. It does not rewrite application source, reapply text replacements, or automatically choose our version of conflicting shared code. New AI modules outside the recorded paths may require a policy update and code review; a green build cannot prove arbitrary future upstream features are AI-free.

## One-time setup

- Enable GitHub Actions in the fork, including scheduled workflows.
- Store the generated private updater key as the repository secret `TAURI_SIGNING_PRIVATE_KEY`. Its public counterpart is `updater.pub` and is embedded in `src-tauri/tauri.conf.json`.
- The generated key has no password; leave `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` unset. Keep a secure backup of the private key. `.local-signing/` is ignored by Git.
- Platform signing is optional: Apple signing/notarization and Windows Authenticode use the upstream workflow's secrets. Updater signatures are mandatory even without those platform certificates.
- Run **Sync upstream without AI** once, or wait for its schedule.

The app keeps upstream's internal version number. The no-AI suffix distinguishes repository tags; it is not a Tauri prerelease channel. A second build with the same internal version is not an automatic upgrade for existing clients. To ship a same-version fix, choose an increasing application version and adjust the release state/policy deliberately.

GitHub can delay scheduled jobs and disables schedules in public repositories after 60 days without repository activity. Repository rules may also prevent the bot from pushing to `main`, or from updating workflow files. These conditions need repository-owner intervention; unattended operation cannot be guaranteed indefinitely.

The initial fork must be installed manually: the original app trusts a different signing key and update repository. Later fork versions use this repository’s updater feed. The app keeps the original application identifier and data directory, so it replaces the original installation and reuses its documents/settings. Legacy AI settings are ignored; old documents and their attribution metadata are preserved.

## When a run stops

A failed merge or test run leaves `main` and its published release untouched. Reproduce the merge locally with `python3 scripts/no-ai/sync-upstream.py prepare`, resolve shared conflicts, run the checks, and inspect the diff before pushing. Do not restore removed AI code merely to make a merge or test pass. Update the deletion policy when upstream moves or adds AI modules.

If a release build failed after the merge was pushed, fix and re-run that release workflow for its tag. The scheduler will not skip past an unpublished version or repeatedly rebuild a failed release. A failed dispatch with no release run is retried on the next schedule.

The native `TAURI_CONFIG` override in sync CI disables missing packaging resources for `cargo check` only. Actual release builds use the full bundle configuration and download real sidecars.
