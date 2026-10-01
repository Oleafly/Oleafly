import { Prec } from "@codemirror/state";
import { type KeyBinding, keymap } from "@codemirror/view";
import { matchesShortcut, useShortcutStore } from "@/store/shortcuts";

/**
 * Whether a keydown is the user's recompile chord (Cmd/Ctrl+Enter unless they
 * rebound it). The binding is read on every call, so a rebind applies at once.
 */
export function isRecompileShortcut(event: KeyboardEvent): boolean {
  return matchesShortcut(event, useShortcutStore.getState().bindings.recompile);
}

/**
 * The recompile chord belongs to App.tsx's window keydown listener. CodeMirror's
 * defaultKeymap binds Mod-Enter to insertBlankLine, and CodeMirror handles the
 * key on its content element before the event bubbles to the window, so the
 * chord used to add a blank line and then compile. This binding claims the key
 * first: CodeMirror calls preventDefault and skips its later bindings, but does
 * not stop propagation, so App still compiles. An `any` binding only runs ahead
 * of bindings registered after it, so list it before defaultKeymap.
 */
export const recompileShortcutBinding: KeyBinding = {
  any: (_view, event) => isRecompileShortcut(event),
};

/**
 * The same guard as a standalone extension, for editors whose keymap is built
 * elsewhere (such as the diagram package's code editor). High precedence puts
 * it ahead of that editor's defaultKeymap wherever the extension is listed.
 */
export const recompileShortcutGuard = Prec.high(keymap.of([recompileShortcutBinding]));
