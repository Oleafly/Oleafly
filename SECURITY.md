# Security Policy

OpenLeaf is a local-first desktop app: your documents, GitHub token, and AI API
keys live on your machine. We take the integrity of that boundary seriously.

## Reporting a vulnerability

**Please do not report security issues in public GitHub issues, discussions, or
pull requests.**

Instead, use GitHub's private vulnerability reporting:

1. Go to the repository's **Security** tab → **Report a vulnerability**
   (or open <https://github.com/prajwal-svm/OpenLeaf/security/advisories/new>).
2. Describe the issue, the affected version/commit, and reproduction steps.

We aim to acknowledge a report within **72 hours** and to ship a fix or
mitigation for confirmed high-severity issues as quickly as we reasonably can.
We'll credit you in the release notes unless you'd prefer to stay anonymous.

## Scope - what we especially care about

Because the frontend can drive privileged Rust commands, we're most interested
in reports about:

- **Path/sandbox escapes** - reading, writing, or deleting files outside a
  project directory (e.g. via crafted paths or project ids, symlinks, or
  traversal). File access is meant to stay within `~/.openleaf/projects/<id>/`.
- **Command execution** - getting the app to run arbitrary programs or shell
  commands.
- **Secret exposure** - leaking the stored GitHub token or AI API keys (from
  encrypted local storage, process arguments, logs, or the network).
- **Webview escapes / XSS** - script injection via rendered AI output, compile
  logs, PDF content, or file contents, bypassing the app's Content Security
  Policy.

## Known limitations (by design, for now)

These are documented trade-offs, not vulnerabilities - though we welcome help
improving them:

- **Secrets at rest** - AI provider credentials, GitHub tokens, and MCP tokens
  are stored as AES-256-GCM authenticated ciphertext under `~/.openleaf/`.
  Ciphertext files, the separate encryption key, and the shared lock file are
  restricted to the current OS user. This prevents plaintext disclosure from
  configuration files, logs, process arguments, and casual filesystem
  inspection.
- **Same-user compromise** - the encryption key and ciphertext are available
  to the same OS account. A malicious process already running as that user may
  be able to read both. The encrypted local store is not equivalent to hardware
  backed storage or isolation from same-user processes.
- **Unsigned builds** - release binaries for macOS and Windows are not yet
  code-signed or notarized.

## Supported versions

OpenLeaf is pre-1.0. Security fixes are applied to the `main` branch and shipped
in the next release; only the latest release is supported.

| Version | Supported |
| --- | --- |
| latest release | ✅ |
| older releases | ❌ |
