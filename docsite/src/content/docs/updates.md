---
title: "Updates"
description: "How Oleafly keeps itself current: signed in-place updates with release notes, automatic checks at startup, and a manual check whenever you want one."
---

Oleafly updates itself in place. No re-downloading installers, no losing your setup: an update downloads, verifies, installs, and relaunches the app right where you left off.

## Automatic checks

At startup, Oleafly quietly checks the release feed (bounded to a few seconds so it never delays your writing). When a new version exists, a dedicated update window appears with the version and its release notes; choose **Update now** or dismiss it with Later (a dismissed version stays quiet for the rest of the session).

## Manual checks

Settings, **Help & About**, **Check for updates** (also in the About dialog and the app menu's "Check for Updates…"). The states are explicit:

- "You're on the latest version", with a link to the current release notes.
- "Update available · vX.Y.Z", with the notes and an **Update now** button.
- A download progress bar, then "Installing… Oleafly will restart to finish."
- If the check fails (offline, GitHub down), an error with **Try again** and a **Download from GitHub** fallback link.

## Signed, verified, and boring by design

Updates come from the project's GitHub Releases and are cryptographically signed; the app verifies each download's signature against a key embedded in the app before installing. A build that doesn't verify doesn't install. There's one release channel (latest stable), and your projects are never touched by an update: they live in [their own folder](/OpenLeaf/where-your-data-lives/), fully separate from the app.

## What's in a release

Every release ships with human-written notes; the same changelog is available in the app under Settings, Help & About, **What's new**, and on the [releases page](https://github.com/prajwal-svm/OpenLeaf/releases). Maintainer-facing details of how releases are built and signed live in [Engineering](/OpenLeaf/engineering/updates/).
