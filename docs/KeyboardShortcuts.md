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

Settings > Shortcuts > Editor records a new chord for any of these. Backspace
leaves an action unbound, Escape cancels, and every row has its own reset.
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
