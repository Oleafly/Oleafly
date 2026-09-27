# Oleafly's tauri-plugin-single-instance patch

This directory contains tauri-plugin-single-instance 2.4.5 from crates.io. The upstream crate archive has SHA-256 `db817fe9295e19b7d8357e900af31edb93703dd9fb6de524b007b47b6afc63b0`. Its Apache-2.0 and MIT licenses are kept in `LICENSE_APACHE-2.0` and `LICENSE_MIT`.

Three platform files and the manifest differ from upstream.

In `src/platform_impl/windows.rs`, a second launch hands its arguments to the running instance with `SendMessageTimeoutW` (`SMTO_ABORTIFHUNG | SMTO_BLOCK`, 5 seconds) instead of `SendMessageW`. `SendMessageW` waits forever, so when the running instance stops processing window messages, every later launch hangs with no window and never exits. With the patch, a launch that gets an answer still exits as before. A launch that gets none starts as a separate instance. Five seconds is also how long Windows waits before it marks a window as not responding.

A launch that keeps running now closes its handle to the instance mutex. Upstream left that handle open, including when the mutex exists but the instance window does not yet. The open handle kept the mutex alive after the first instance quit, so no later launch could take over as the single instance.

In `src/platform_impl/linux.rs`, upstream unwraps the session bus builder. A `DBUS_SESSION_BUS_ADDRESS` that zbus cannot parse, such as `disabled:`, `autolaunch:` or an empty string, makes the app panic at startup. The patch sends that error down the path upstream already takes for an unreachable bus, and the app starts without single-instance handling.

In `src/platform_impl/macos.rs`, upstream puts the socket at `/tmp/<identifier>_si.sock`. Every account on the Mac shares `/tmp`, so another user could create that socket first, and from then on each launch would send its arguments and working directory to that user's process and quit. The patch moves the socket into the per-user temporary folder that `confstr(_CS_DARWIN_USER_TEMP_DIR)` returns, and a launch refuses to connect to a socket that another user owns. If that folder can't be found, or the path would be too long for a socket, it falls back to `/tmp/<identifier>_<uid>_si.sock` with the same owner check. `Cargo.toml` adds `libc` on macOS for these calls.

The tests in `src-tauri/src/single_instance.rs` cover all three changes. Keep this patch until upstream puts a limit on the Windows hand-off, stops unwrapping the session bus builder and moves the macOS socket out of `/tmp`.
