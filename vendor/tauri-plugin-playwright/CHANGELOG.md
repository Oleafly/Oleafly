# tauri-plugin-playwright

## 0.3.0

### Minor Changes

- Add multi-window targeting via a new `CommandEnvelope` wire wrapper. Clients
  can now set an optional `window` field on any command to target a specific
  webview window; when omitted, the server falls back to the plugin's
  configured default label. Existing clients that send a bare `Command`
  (no `window` field) keep working unchanged.
- Add `ListWindows` command that enumerates open webview windows and returns
  `Vec<WindowInfo { label, url, title, visible }>`. Test code uses this to
  discover newly-opened windows (e.g., a viewer or settings dialog) and pin
  subsequent commands to them.

## 0.2.2

- Harden plugin internals from PR #1 review suggestions: use serde_json for
  script ID injection, validate `pw_result` success path with
  `serde_json::Value`, and add retry/backoff for window readiness during app
  startup.
