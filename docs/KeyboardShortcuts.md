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
| Toggle terminal | Ctrl-` | Ctrl-` |
| New terminal | Ctrl-Shift-` | Ctrl-Shift-` |
| Close terminal | Ctrl-Shift-W | Ctrl-Shift-W |
| Next terminal | Ctrl-PageDown | Ctrl-PageDown |
| Previous terminal | Ctrl-PageUp | Ctrl-PageUp |
| Toggle sidebar | Command-B | Ctrl-B |
| Toggle PDF preview | Command-Option-P | Ctrl-Alt-P |
| Toggle Zen mode | Ctrl-Command-Shift-F | Shift-F11 |
| Open folder | Command-Shift-O | Ctrl-Shift-O |
| Open settings | Command-, | Ctrl-, |
| Zoom in | Command-= | Ctrl-= |
| Zoom out | Command-- | Ctrl-- |
| Reset zoom | Command-0 | Ctrl-0 |
| Close LaTeX environment | Command-Option-. | Ctrl-Alt-. |
| Surround with environment | Command-Option-E | Ctrl-Alt-E |

New terminal works anywhere in a project. Close terminal, Next terminal and
Previous terminal act while focus is in the terminal dock, including inside a
terminal.

Zen mode hides the toolbar, sidebar, assistant and terminal so only the editor
(and the PDF, if it was showing) is left. While it is on, the toggle shortcuts
for the sidebar and terminal, the command palette and search still
work, and Toggle PDF preview shows or hides the PDF, including one a compile
opened. Press Escape twice within half a second, or use the same shortcut, to
leave. Command-B and Ctrl-B still mean Bold while the editor has focus, so the
sidebar toggle only works from outside the editor. Settings > Appearance >
Project has the Zen mode options.

The reference list is generated from `SHORTCUT_DEFINITIONS` in
`src/store/shortcuts.ts`; it is the source of truth for labels and defaults.

## Editor keys

These live in the editor's own keymap rather than the shortcut store, so they
are not remappable. They apply in LaTeX sources. The keys in the next two
sections are the exception.

| Key | Effect |
| --- | --- |
| Enter on an `\item` line | Starts the next item at the same level |
| Enter at the end of a `\begin{...}` line | Writes the matching `\end` below |
| Shift-Enter | Plain newline, no item marker |
| Backspace behind an `\item` marker | Blanks the marker, then deletes it |
| Backspace inside an empty math pair | Removes both delimiters |

The completion popup binds Enter ahead of these keys. When it has a suggestion
ready, it takes the key; otherwise Enter falls through to the editor keys
below.

## Keybinding modes

Settings > Appearance > Editor picks the keybinding set the source editor
uses: Default, Vim or Emacs. Vim keeps its status line and its `:w` save.
Emacs binds `C-s` and `C-r` to the search panel, pushing the mark first so
`C-x C-x` comes back, `C-x C-s` to save, `C-a` and `C-e` to the start and end
of the visual line, and `C-k` to kill to the visual line end. A mode sees a
key before every other editor binding, so while Vim or Emacs is on it wins
any chord it claims.

## Remappable editor keys

Settings > Keyboard Shortcuts > Editor keys records a new chord for any of
these. Backspace leaves an action unbound, Escape cancels, and every row has
its own reset.
The reset control at the foot of the section restores the application
shortcuts and these together.

| Action | macOS | Windows/Linux |
| --- | --- | --- |
| Uppercase | Ctrl-U | Ctrl-U |
| Lowercase | Ctrl-Shift-U | Ctrl-Shift-U |
| Title case | unbound | unbound |
| Delete line | Command-D | Ctrl-D |
| Duplicate selection or line | Command-Shift-D | Ctrl-Shift-D |
| Add cursor above | Ctrl-Option-Up | Ctrl-Alt-Up |
| Add cursor below | Ctrl-Option-Down | Ctrl-Alt-Down |
| Go to line | Command-Shift-L | Ctrl-Shift-L |
| Toggle comment | Command-/ | Ctrl-/ |
| Select next occurrence | unbound | unbound |
| Indent | unbound | unbound |
| Outdent | unbound | unbound |

Two defaults shadow a CodeMirror one. Delete line takes `Mod-D` from select
next occurrence, which is why that action ships unbound; bind it elsewhere if
you want it. Uppercase takes `Ctrl-U` from undo selection on Windows and
Linux. `Shift-Mod-K` still deletes a line and `Mod-Alt-Up` and `Mod-Alt-Down`
still add cursors whatever you remap.

`Mod-/` is also the default for the shortcut reference. Inside the editor the
comment toggle wins and the reference stays shut; anywhere else the reference
opens.

## Terminal keys

While a terminal has focus, keys go to the shell. These app shortcuts still
work from the terminal: Toggle terminal, Command palette, Open settings and the
four terminal tab shortcuts, with whatever bindings you gave them. On macOS
every other Command shortcut keeps working too, except Command-F, Command-K,
Command-Left, Command-Right and Command-Backspace, which the terminal uses, so
Command-K clears the terminal there instead of opening the command palette. On
Windows and Linux, Ctrl with a letter, Alt combinations, function keys and keys
such as Enter, Tab and the arrows go to the shell. Chords a shell has no use
for, such as Ctrl-Shift-F, Ctrl-= and Ctrl-0, still reach Oleafly. Characters
typed with an input method or AltGr always reach the shell.

The terminal turns these keys into what shells and command-line programs
expect:

| Key | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Shift-Enter | New line (LF) | ESC CR, LF under WSL | New line (LF) |
| Option-Left, Option-Right | Word left, word right | | |
| Alt-Left, Alt-Right | | Word left, word right (as Ctrl-Left, Ctrl-Right) | Word left, word right (as Ctrl-Left, Ctrl-Right) |
| Alt-Up, Alt-Down (Option on macOS) | Sent as Ctrl-Up, Ctrl-Down | Sent as Ctrl-Up, Ctrl-Down | Sent as Ctrl-Up, Ctrl-Down |
| Command-Left, Command-Right | Start, end of line | | |
| Command-Backspace | Delete to line start | | |
| Command-K | Clear the terminal | | |
| Ctrl-Backspace | | | Delete word before |
| Ctrl-Delete | | Delete word after | Delete word after |
| Ctrl-/ | Undo (0x1F) | Undo (0x1F) | Undo (0x1F) |
| Ctrl-Shift-C, Ctrl-Shift-V | | Copy, paste | Copy, paste |
| Ctrl-C with text selected, Ctrl-V | | Copy, paste | |
| Ctrl-F (Command-F on macOS) | Find | Find | Find |

Shift-Enter sends a plain Enter instead when Settings > Appearance > Terminal
says so.

## Configuration model

- Users can change bindings from the shortcut settings surface.
- Bindings are validated before being stored in local application state.
- Reset one binding or restore all defaults.
- Modifier-only keys and invalid platform combinations are rejected.
- Reserved operating-system and browser commands are reported rather than
  silently shadowed.

## Engineering anchors

- `src/store/shortcuts.ts`: definitions, matching, persistence, and labels.
- `src/store/editor-keymap.ts`: editor key definitions, parsing, and
  persistence.
- `packages/editor/src/editor-commands.ts` and `emacs-mode.ts`: the editor
  commands behind the remappable keys and the Emacs customisations.
- `src/store/shortcuts.test.ts`: platform, persistence, and reservation tests.
- `src/contributions/commands.tsx`: command registration and execution.
