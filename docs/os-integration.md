# Opening folders and files from the operating system

Oleafly can open a folder, or a LaTeX, Typst or Markdown file, that the operating system hands it: from Finder, File Explorer, a Linux file manager, the Dock, or a second launch of the app. All of these end up in the same queue of open requests (`src-tauri/src/open_request.rs`), so the folder gets the same checks as **Open folder…** in the library.

## macOS

- The bundle declares `public.folder` as a document type with the Editor role and the `Alternate` rank (`src-tauri/tauri.macos.conf.json`). Dropping a folder on the Dock icon or running `open -a Oleafly <folder>` opens it. Oleafly never becomes the default app for folders.
- The bundle also claims `.tex`, `.typ`, `.md` and `.markdown` by extension (Editor role, `Default` rank). Finder lists Oleafly under **Open With** for these files and no longer warns that it may not open them.
- The first launch of a release build makes Oleafly the default app for those files, through `LSSetDefaultRoleHandlerForContentType`, without asking. That happens once: `~/.oleafly/system-integration.json` records it, so if someone later picks another app, their choice stays. Debug builds, e2e builds and runs with `OLEAFLY_DATA_DIR` set don't touch the defaults.
- LaunchServices hands the folder over as `RunEvent::Opened`. The `system-integration` plugin passes `file://` URLs to the queue and drops anything else. On a cold start the event arrives before any window exists. The queue is already there by then, so the request waits until the window picks it up.
- The Finder right-click entry is a Quick Action. **Settings › General › System integration** writes `~/Library/Services/Open in Oleafly.workflow`, which runs `/usr/bin/open -b <bundle id> "$@"`. Oleafly writes the workflow files itself rather than copying them out of the app bundle, and then clears `com.apple.quarantine` from each one, so Gatekeeper doesn't block it. After the first folder someone opens with **Open folder…**, the app offers to add it. It asks once.
- A new Quick Action appears under Services right away, but Finder leaves it out of the Quick Actions menu until the user turns it on in Quick Actions › Customize. Settings reads that switch with `defaults export pbs -` and never writes the `pbs` domain. The `NSServicesStatus` key it looks up is built from the installed workflow's `CFBundleIdentifier` and menu title, so a change of app language doesn't send it to the wrong entry. While the switch is off, the row says how to turn it on and checks again when the window gets focus. If the switch is already on from an earlier install, the offer card's confirmation skips that step. A `CFBundleIdentifier` from another build marks the row as needing attention, and Repair rewrites both files to match. A menu title in another language doesn't.
- Folders opened in place show up in the Dock's Recents menu through `noteNewRecentDocumentURL`.
- A second launch from Terminal reaches the running app through the single-instance socket. The socket lives in the per-user temporary folder, not `/tmp`, and a launch only connects to a socket owned by the same user.

## Windows

- On launch, release builds write `HKCU\Software\Classes\Directory\shell\Oleafly` and `HKCU\Software\Classes\Directory\Background\shell\Oleafly`. Each key gets the label, the app's icon and the command `"<Oleafly.exe>" --open-folder "%V"`. There is no verb for drives.
- Every launch compares the keys with the running copy and rewrites them if they differ, for example after an update or a switch between the NSIS and MSI installers. Debug builds, e2e builds and runs with `OLEAFLY_DATA_DIR` set never touch the registry.
- The switch in **Settings › General › System integration** removes the keys and remembers that in `~/.oleafly/system-integration.json`, so the next launch doesn't put them back.
- The NSIS uninstaller (`src-tauri/windows/hooks.nsh`) removes both keys when they point at the copy being uninstalled. During an update it leaves them alone.
- The MSI installer (`src-tauri/windows/explorer-menu.wxs`) does the same. An uninstall removes both keys when they point at the copy being uninstalled, and an upgrade leaves them alone.
- On Windows 11 the entry is under **Show more options**. A top-level entry needs a signed MSIX package.
- The NSIS and MSI installers register `.tex`, `.typ`, `.md` and `.markdown` (`src-tauri/tauri.windows.conf.json`). Each extension gets its own ProgID (`Oleafly.tex`, `Oleafly.typ`, …), and its open command is `"<Oleafly.exe>" "%1"`. Oleafly becomes the default for any of these types the user hasn't picked an app for. A pick the user already made lives in the hash-protected `UserChoice` key, and Windows doesn't let an installer change it. Uninstalling with NSIS hands each extension back to the ProgID it had before; uninstalling the MSI removes the registration.

## Linux

- The .deb and .rpm launchers come from `src-tauri/linux/main.desktop`, with `Exec=/usr/bin/oleafly-desktop %F`. They never list `inode/directory`, so Oleafly can't become the default folder handler.
- The AppImage has its own launcher (`src-tauri/linux/appimage.desktop`) with `Exec=oleafly-desktop %F`. AppRun runs the first word of `Exec`, and an absolute path there would start whatever copy sits at that path instead of the one inside the AppImage.
- The .deb and .rpm launcher lists `text/x-tex`, `text/vnd.typst` and `text/markdown` in `MimeType=`. File managers then offer Oleafly for `.tex`, `.typ` and `.md` files, plus the other extensions those types cover, such as `.sty` and `.markdown`. The packages also install `/usr/share/mime/packages/oleafly.xml`, which defines `text/vnd.typst` for `*.typ`, with `text/x-typst` as its alias. shared-mime-info has had Typst only since 2.4, where it was `text/x-typst`; 2.5 renamed it `text/vnd.typst`. Debian 12 ships 2.2, so without this file a `.typ` file gets either the old name or no type at all.
- The AppImage's menu entry carries the same `MimeType=` line. While Oleafly keeps that entry, it also keeps `~/.local/share/mime/packages/oleafly.xml` up to date and runs `update-mime-database` when that file changes, and `update-desktop-database` when the entry does.
- The first launch of a release build adds Oleafly to `[Default Applications]` in `~/.config/mimeapps.list` (or under `$XDG_CONFIG_HOME`) for each of the three types with no entry there yet. An alias such as `text/x-markdown` counts as an entry. A package names `Oleafly.desktop`; an AppImage names its own menu entry. This happens once and is recorded in `~/.oleafly/system-integration.json`. A default the user set stays, and desktop-specific files such as `gnome-mimeapps.list` win over `mimeapps.list` anyway.
- The .deb and .rpm also install a Dolphin service menu (`/usr/share/kio/servicemenus/oleafly-open-folder.desktop`) and a Nemo action (`/usr/share/nemo/actions/oleafly-open-folder.nemo_action`). They do nothing on systems without those file managers.
- **Settings › General › System integration** can write user-level files:
  - Dolphin and Nemo actions for an AppImage or any copy that didn't come from a package. These point at `$APPIMAGE`.
  - A GNOME Files script in `~/.local/share/nautilus/scripts`. Scripts behave the same in Nautilus 42 and 43 or later. The GTK 4 port in 43 changed the Python extension API, which Oleafly doesn't use.
  - A hidden `<identifier>.open-folder.desktop` entry with `MimeType=inode/directory`, which lists Oleafly under **Open With** for folders. It is only offered when `xdg-mime query default inode/directory` already names a file manager, and Oleafly never runs `xdg-mime default`.
- `src-tauri/src/system_integration/tests.rs` checks that the shipped files match the Rust code that writes the user-level copies, translated names included.

## Opening a file

A file from the system opens the folder that holds it, with the same checks as a folder, then opens in a tab. If that folder is inside a project already in the library, that project opens. If the folder has no clear main document, the file becomes it. A file sitting directly in Desktop, Documents, Downloads or another standard user folder still opens, with that folder as the project, even though **Open folder…** turns those folders down as too broad. The home folder, temporary folders and app data are still refused.

## Arguments and second launches

The app accepts `--open-folder <path>`, `--open-folder=<path>` and bare paths. Relative paths resolve against the working directory of the process that received them. When the app is already running, the single-instance plugin forwards a new launch's arguments and working directory, and the running app queues them the same way.
