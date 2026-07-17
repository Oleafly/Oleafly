# GitHub sync

OpenLeaf is local-first, so every project already has its own `.git` history on disk. GitHub integration lets you back a project up to the cloud and sync it across your machines. There's no OpenLeaf account, just your own GitHub.

## Connect your account (once per machine)

1. Open Settings → GitHub.
2. Click **Connect GitHub**. A one-time code appears in the app, and your browser opens to `github.com/login/device`.
3. Enter the code and authorize OpenLeaf. The app detects it within a few seconds and shows your account.
4. Your account badge now appears in the top toolbar.

This uses OAuth device flow, so there's no copy-pasting long-lived tokens, and the app only requests `repo` + `read:user` scope.

> Prefer a personal access token (e.g. for CI or fine-grained scopes)? Expand **Advanced: use a personal access token** and paste a PAT instead.

## Publish a project

To put a project on GitHub for the first time:

1. Open the Source Control panel (the branch icon in the rail).
2. Click **Publish to GitHub**.
3. Choose one of:
   - **Create new repository**: pick a name and public/private. OpenLeaf creates it, links it as the project's `origin`, and pushes.
   - **Link existing**: pick one of your repos. OpenLeaf sets `origin` and pushes.

Once published, Push and Pull become enabled.

## The daily loop

- **Commit**: write a message and commit locally (auto-commits also happen on save).
- **Push**: commits and pushes to GitHub in one click. Use this on your first machine when you're done.
- **Pull**: on your other machine, pull to get the latest. The panel shows ahead/behind counts so you know when to push or pull.

### Two-device workflow

1. Machine A: work, then Push.
2. Machine B: open the project, Pull, continue.

Your full history travels with the repo, so you can also clone it elsewhere or browse it on github.com.

## Changing or removing the remote

- **Change repo**: re-run Publish to point the project at a different repo.
- **Unlink**: removes the `origin` remote. The local project and history are untouched, and Push/Pull are disabled until you publish again.

## Disconnect your account

In Settings → GitHub, the connected-account card has a **Disconnect** button. This clears the token from this machine only. It doesn't affect the repos you've already pushed.

## Notes and troubleshooting

- SSH remotes aren't supported for token-authenticated push. Use HTTPS (Publish sets this up automatically).
- A first push to an existing repo that already has commits may need a pull first. OpenLeaf will tell you.
- The token is stored in authenticated encrypted local storage under
  `~/.openleaf/`. The encrypted data, encryption key, and lock file are
  restricted to the current OS user.
- The token is never written to `config.json`, process arguments, or Git remote
  URLs.
