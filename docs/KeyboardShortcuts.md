# Keyboard shortcuts

Shortcuts are application contributions backed by a small typed store. The
default bindings are platform-aware: `Mod` means Command on macOS and Ctrl on
Windows and Linux.

## Default bindings

| Action | macOS | Windows/Linux |
| --- | --- | --- |
| Recompile | Command-Enter | Ctrl-Enter |
| Command palette | Command-K | Ctrl-K |
| Search all documents | Command-Shift-F | Ctrl-Shift-F |
| Go to PDF (SyncTeX) | Command-Shift-J | Ctrl-Shift-J |
| Shortcut reference | Command-/ | Ctrl-/ |
| Close LaTeX environment | Command-Option-. | Ctrl-Alt-. |
| Surround with environment | Command-Option-E | Ctrl-Alt-E |

The reference list is generated from `SHORTCUT_DEFINITIONS` in
`src/store/shortcuts.ts`; it is the source of truth for labels and defaults.

## Configuration model

- Users can change bindings from the shortcut settings surface.
- Bindings are validated before being stored in local application state.
- Reset one binding or restore all defaults.
- Modifier-only keys and invalid platform combinations are rejected.
- Reserved operating-system and browser commands are reported rather than
  silently shadowed.

## Engineering anchors

- `src/store/shortcuts.ts`: definitions, matching, persistence, and labels.
- `src/store/shortcuts.test.ts`: platform, persistence, and reservation tests.
- `src/contributions/commands.tsx`: command registration and execution.
