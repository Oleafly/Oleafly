// Connects the terminal key router to xterm's custom key handler. The router
// decides; this applies the decision to the event and the terminal.
import { routeTerminalKey, type TerminalKeyContext } from "@/lib/terminal-keys";

/** The parts of an xterm Terminal the key handler uses. */
export interface TerminalKeyTarget {
  /** Sends bytes as if the user typed them (onData fires). */
  input(data: string): void;
  hasSelection(): boolean;
  getSelection(): string;
  clearSelection(): void;
  clear(): void;
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void;
}

export interface TerminalKeyHooks {
  context(): Omit<TerminalKeyContext, "hasSelection">;
  copy(text: string): void;
  find(): void;
}

function cancel(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

/**
 * Handles keydown through the router and swallows the keypress that follows
 * a key it sent. Returning false tells xterm to leave the event alone; only
 * cancelled events stop there, so app shortcuts and the webview's own paste
 * still see theirs.
 */
export function attachTerminalKeys(terminal: TerminalKeyTarget, hooks: TerminalKeyHooks): void {
  let swallowKeypress = false;
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type === "keypress") {
      if (!swallowKeypress) return true;
      swallowKeypress = false;
      return false;
    }
    if (event.type !== "keydown") {
      swallowKeypress = false;
      return true;
    }
    const action = routeTerminalKey(event, { ...hooks.context(), hasSelection: terminal.hasSelection() });
    switch (action.kind) {
      case "send":
        cancel(event);
        terminal.input(action.data);
        swallowKeypress = true;
        return false;
      case "copy":
        cancel(event);
        if (terminal.hasSelection()) hooks.copy(terminal.getSelection());
        if (action.clearSelection) terminal.clearSelection();
        return false;
      case "paste":
        // The webview's paste event reaches xterm, which applies bracketed paste.
        return false;
      case "find":
        cancel(event);
        hooks.find();
        return false;
      case "clear":
        cancel(event);
        terminal.clear();
        return false;
      case "ignore":
        cancel(event);
        return false;
      case "app":
        return false;
      default:
        return true;
    }
  });
}
