# Oleafly's tauri-plugin-single-instance patch

This directory contains tauri-plugin-single-instance 2.4.5 from crates.io. The upstream crate archive has SHA-256 `db817fe9295e19b7d8357e900af31edb93703dd9fb6de524b007b47b6afc63b0`. Its Apache-2.0 and MIT licenses are kept in `LICENSE_APACHE-2.0` and `LICENSE_MIT`.

Two files differ from upstream. The macOS code is untouched.

In `src/platform_impl/windows.rs`, a second launch hands its arguments to the running instance with `SendMessageTimeoutW` (`SMTO_ABORTIFHUNG | SMTO_BLOCK`, 5 seconds) instead of `SendMessageW`. `SendMessageW` waits forever, so when the running instance stops processing window messages, every later launch hangs with no window and never exits. With the patch, a launch that gets an answer still exits as before. A launch that gets none starts as a separate instance. Five seconds is also how long Windows waits before it marks a window as not responding.

A launch that keeps running now closes its handle to the instance mutex. Upstream left that handle open, including when the mutex exists but the instance window does not yet. The open handle kept the mutex alive after the first instance quit, so no later launch could take over as the single instance.

In `src/platform_impl/linux.rs`, upstream unwraps the session bus builder. A `DBUS_SESSION_BUS_ADDRESS` that zbus cannot parse, such as `disabled:`, `autolaunch:` or an empty string, makes the app panic at startup. The patch sends that error down the path upstream already takes for an unreachable bus, and the app starts without single-instance handling.

The tests in `src-tauri/src/single_instance.rs` cover both changes. Keep this patch until upstream puts a limit on the Windows hand-off and stops unwrapping the session bus builder.
