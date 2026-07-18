---
title: "GitHub sync"
description: "Connect GitHub with a device code or a token, publish a project as a new or existing repo, push and pull between machines, and how your token is protected."
---

GitHub sync gives every project an off-machine backup and a way to move between computers, built on the [real Git repo](/OpenLeaf/git-history/) each project already is. There's no Oleafly account in the picture, just your own GitHub.

## Connecting your account

Settings, **GitHub**, then either route:

- **Connect GitHub** (recommended): a device-code flow. Oleafly shows a short code, your browser opens `github.com/login/device` (with a **Copy** button for the code), you approve, and the app detects it within seconds. The connection requests only the `repo` and `read:user` scopes.
- **Personal access token**: expand "Advanced: use a personal access token" and paste a PAT if you prefer minting your own credentials.

Once connected, your avatar and username appear in Settings and in the top toolbar's GitHub menu. **Disconnect** forgets the token.

### How your token is protected

The token is stored in Oleafly's local config and never handed to the app's UI layer; the interface only ever learns "connected as @you". When Git needs to authenticate, the token is injected through an in-memory credential helper, so it never appears in a command line, in `.git/config`, or in your shell history. Older builds that embedded tokens in remote URLs are cleaned up automatically at startup.

## Publishing a project

In the Source Control panel, click **Publish to GitHub**:

- **Create new repository**: pick a name (pre-filled from the project), keep **Private (recommended)** checked or not, and **Create & push**. Oleafly creates the repo, makes the initial commit, wires up `origin`, and pushes.
- **Link existing**: pick from a searchable list of your repositories (private ones show a lock) and **Link & push**.

After publishing, the toolbar's GitHub menu offers **Open in GitHub** and **Copy repository link**.

## Day-to-day sync

The Source Control panel's **Push** and **Pull** buttons do what they say, against `origin` on your current branch. The **ahead/behind** indicator (↑ ↓) next to the branch pill tells you when there's something to push or pull.

### Two computers

1. On machine A: publish the project, work, **Push**.
2. On machine B: connect the same GitHub account and get the repo into `~/.openleaf/projects/` (clone it there with Git, or copy the project folder once). From then on, **Pull**, work, **Push**.
3. Back on A: **Pull** before you start. The indicator reminds you.

Cover color, main-document choice, and history all travel, because they live in the project folder itself.

## Changing your mind

- **Change repo** re-opens the publish dialog to point `origin` somewhere else.
- **Unlink** removes the remote; the local project and its history are untouched.

## Limits, stated plainly

- **Conflicts aren't resolved in-app.** If a pull hits a merge conflict, the raw Git message is shown; resolve it with any Git tool, then carry on in Oleafly.
- **HTTPS remotes** are what Oleafly authenticates; Publish sets this up correctly for you.
- **No branch UI yet**: the app works on your current branch (`main` by default); branching happens on the command line if you want it.

## If something fails

- "No remote 'origin'": publish first; Push and Pull need a remote.
- Push rejected because the remote has commits: pull first, then push.
- "No GitHub token set": connect in Settings, GitHub.

More in the [FAQ](/OpenLeaf/faq/#github-sync).
