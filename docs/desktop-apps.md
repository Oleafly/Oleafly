# Desktop apps

Desktop apps let agents work in apps and websites on your computer: the built-in assistant, CLI agents in a chat, and research tasks you watch. Oleafly drives them through [Cua Driver](https://cua.ai/docs/cua-driver), an open source program from Cua. Oleafly never installs, bundles or updates Cua Driver for you.

Agents see one tool, `desktop_apps`. Looking at windows and pages runs right away. Every click, keystroke and page change asks you first, in a system dialog.

Turn it on in **Settings > Integrations > Desktop apps**.

## Install Cua Driver

Settings shows the official install line for your system. "Run in terminal" opens it in a project terminal and asks before it runs. You can also copy the line and run it yourself.

| System | Install line |
|---|---|
| macOS, Linux | `/bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)"` |
| Windows | `powershell.exe -NoProfile -Command "irm https://cua.ai/driver/install.ps1 \| iex"` |

Oleafly needs Cua Driver 0.36.0 or newer. It looks for it here:

- macOS: `/Applications/CuaDriver.app`, `~/Applications/CuaDriver.app`, then `~/.local/bin/cua-driver`.
- Linux: `$CUA_DRIVER_RS_HOME/packages/current/cua-driver`, `~/.cua-driver/packages/current/cua-driver`, then `~/.local/bin/cua-driver`.
- Windows: `%LOCALAPPDATA%\Programs\Cua\cua-driver\bin\cua-driver.exe`, then `%USERPROFILE%\.cua-driver\packages\current\cua-driver.exe`.
- Then the search path.

**macOS permissions.** Cua Driver needs Accessibility and Screen Recording. Settings shows whether it has them. "Grant permissions" runs `cua-driver permissions grant` in a terminal; follow its prompts. The permissions belong to CuaDriver.app, not to Oleafly. Install with the official installer so the app bundle exists; a bare `cua-driver` program can't hold them.

**GNOME on Wayland.** Cua's window helper extension has to be on. Settings shows its state and the helper's install line (`~/.cua-driver/packages/current/wayland-helper/install.sh`). Run it once, then log out and back in.

**Windows autostart.** The Cua installer can also set up `cua-driver autostart` for other apps that use Cua. Oleafly doesn't need it: it starts its own copy of Cua Driver with your limits and stops it again.

## What agents may use

You choose the apps and websites:

- **Allowed apps.** Pick from the installed apps or choose a program file. On macOS an app is its bundle id; on Windows and Linux it is the program's full path. Some apps can never be added: Oleafly itself, Cua Driver, terminals and shells, system settings, password managers, script runners, programs that start other programs (such as `env` or `python`), and Flatpak or Snap apps. The picker shows why.
- **Allowed websites.** Enter `https://` addresses (or `http://` for this computer). Each site opens in a separate browser profile. Turn on "Use my signed-in browser" for a site to let agents work in your own Chrome or Edge there instead.
- **Scripted control.** Off by default. When on, agents may run Cua scripts that do many steps at once. Each script asks you every time.

These settings stay on this computer. They are not in the settings file or in sync, because app paths and bundle ids mean nothing on another machine.

## How Oleafly runs Cua Driver

Oleafly starts up to three Cua Driver processes of its own, only while they are needed:

| Runtime | Used for | Browser profile |
|---|---|---|
| Desktop | Allowed apps | none |
| Browser | Allowed websites | a separate profile |
| Signed-in browser | Websites marked for it | your own profile |

Each one runs in **bounded** mode with a capability manifest Oleafly writes to `cua/` in Oleafly's data folder (`~/.oleafly/cua/` by default). The manifest lists exactly the apps or sites and the tools it may use. It expires after 8 hours and after 30 idle minutes; Oleafly starts a fresh process when that happens. A process nobody used for 25 minutes stops, and quitting Oleafly stops them all. If Oleafly crashed, it cleans up the old processes at the next start.

On macOS Oleafly starts Cua Driver through `open -a CuaDriver.app`, so the macOS permissions stay with CuaDriver.app. Telemetry and the update check are off. On Windows the process listens on a named pipe for your user; elsewhere on a socket in Oleafly's data folder.

Before using a process, Oleafly checks that it is bounded: it asks for a tool no manifest allows. If Cua Driver runs it anyway, Oleafly stops the process and reports it.

No manifest ever allows these tools: `kill_app`, `install_extension`, `set_config`, `install_ffmpeg`, `replay_trajectory`, `clipboard_read`, `clipboard_write`, `parse_visual_regions`, `get_desktop_state`, `page`, `browser_download`, `browser_set_input_files`, `start_recording`, `stop_recording` and `escalate_session`. `run_script` is allowed only with scripted control on.

## Approvals

- **Looking** (`list_apps`, `list_windows`, `get_window_state`, `get_browser_state`) runs without asking.
- **Actions** (clicks, typing, keys, opening apps, page changes) ask in a system dialog: "Allow once", "Allow for this chat" (or session, or task), or "Don't allow". Escape means don't allow.
- **Batches** (`run_steps`) ask once and list every step.
- **Scripts** (`run_script`) ask every time, with no "Allow for this…" choice.
- A dialog that gets no answer counts as "Don't allow".

Your approval mode and allow rules don't skip these questions, not even Full access. A deny rule for `desktop_apps` in a project's approval rules turns desktop apps off for that project. Folders you haven't trusted never get desktop apps.

Oleafly's log records only the tool name and whether a call ran, was refused or failed. It never records what an agent typed or the arguments it sent.

## CLI agents and research tasks

CLI agents get desktop apps as an extra MCP server, `oleafly-desktop-apps`, when you start or reconnect a chat with desktop apps on. Some agents also ask their own permission question for the tool before Oleafly's dialog.

Research tasks get desktop apps when their brief allows it. They need you at the computer to approve actions, so a task that starts on a schedule or keeps running after Oleafly closes can't use them.

## Cua Spaces

Cua Spaces gives agents isolated desktops and containers. Oleafly can add it as an MCP server, `cua daemon mcp`, from the same settings page once the `cua` command is installed:

| System | Install line |
|---|---|
| macOS, Linux | `curl -fsSL https://cua.ai/install.sh \| sh` |
| Windows | `powershell.exe -NoProfile -Command "irm https://cua.ai/install.ps1 \| iex"` |

It connects read-only (`--permissions spaces:readonly`) and without your agent sign-ins (`CUA_SPACES_AGENT_CREDENTIALS_HOME=none`). "Allow changes" and "Share my agent sign-ins" turn those on. Every Spaces call asks through the MCP approval, and long calls can run into the MCP tool time limit.

## Troubleshooting

"Test connection" starts each runtime, checks it is bounded and runs `cua-driver doctor`. If something still looks wrong, these commands show what Oleafly relies on. Replace the paths with yours.

1. The version: `cua-driver --version` prints `cua-driver 0.36.0` or newer.
2. A bounded process starts with Oleafly's manifest (turn desktop apps on once so the manifest exists):
   - macOS: `open -n -g -a /Applications/CuaDriver.app --env CUA_DRIVER_RS_TELEMETRY_ENABLED=false --env CUA_DRIVER_RS_UPDATE_CHECK=false --stdout /tmp/cua-test.log --stderr /tmp/cua-test.log --args serve --socket /tmp/cua-test.sock --pid-file /tmp/cua-test.pid --permission-mode bounded --capability-manifest ~/.oleafly/cua/desktop.manifest.yaml --approve-capability-manifest`
   - Linux: `cua-driver serve --socket /tmp/cua-test.sock --pid-file /tmp/cua-test.pid --permission-mode bounded --capability-manifest ~/.oleafly/cua/desktop.manifest.yaml --approve-capability-manifest`
   - Windows: `cua-driver serve --socket \\.\pipe\cua-test --pid-file %TEMP%\cua-test.pid --permission-mode bounded --capability-manifest %USERPROFILE%\.oleafly\cua\desktop.manifest.yaml --approve-capability-manifest`
3. The client connects: `cua-driver mcp --socket /tmp/cua-test.sock` (on Windows `\\.\pipe\cua-test`), then send `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`. Calling `get_screen_size` must be refused.
4. On Windows, the process answers `cua-driver status --socket \\.\pipe\cua-test`.
5. The process stops: `cua-driver stop --socket /tmp/cua-test.sock`.
6. On macOS, telemetry is off in the started process: `ps eww $(cat /tmp/cua-test.pid) | grep CUA_DRIVER_RS_TELEMETRY_ENABLED`.
7. A browser-only manifest accepts `start_session` and `end_session`: add one website, run "Test connection", then ask the assistant to call `desktop_apps` with `start_session`.
8. The signed-in browser opens: mark a site for it and ask the assistant to run `browser_prepare` with `browser: "signed_in"`.
9. The status commands Settings reads: `cua-driver permissions status --json` (macOS) and `cua-driver doctor --json`.
10. The GNOME helper: `gnome-extensions info winrects@cua` shows `State: ACTIVE`.

Oleafly's own processes write their logs to `cua/<runtime>.log` in Oleafly's data folder.
