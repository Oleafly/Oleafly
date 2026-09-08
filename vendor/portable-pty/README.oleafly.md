# Oleafly's portable-pty patch

This directory contains portable-pty 0.9.0 from crates.io. The upstream crate archive has SHA-256 `b4a596a2b3d2752d94f51fac2d4a96737b8705dddd311a32b9af47211f08671e`. Its MIT license is preserved in `LICENSE.md`.

The only source change removes `PSEUDOCONSOLE_INHERIT_CURSOR` from the Windows `CreatePseudoConsole` flags. The resize and Win32 input flags remain unchanged.

Oleafly creates a fresh terminal with its own cursor position. A hidden or closing terminal may never answer the cursor query. Windows can then block pseudo-console shutdown or resizing while waiting for that reply. See [Microsoft's pseudoconsole lifecycle documentation](https://learn.microsoft.com/en-us/windows/console/creating-a-pseudoconsole-session#ending-the-pseudoconsole-session).

The terminal regressions in `src-tauri/src/terminal.rs` cover hidden output and closing a session during a blocked paste. Keep this patch until the dependency offers a way to disable cursor inheritance.
