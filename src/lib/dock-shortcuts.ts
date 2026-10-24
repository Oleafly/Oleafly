import { useSettingsStore } from "@/store/settings";
import { logError } from "@/lib/log";
import { isInsideTerminalDock } from "@/lib/terminal-keys";
import { openNewTerminal } from "@/lib/terminal-open";
import { terminalOwnsKey } from "@/lib/terminal-shortcut-guard";
import { matchesShortcut, useShortcutStore } from "@/store/shortcuts";
import { useTerminalsStore } from "@/store/terminals";
import { toggleZenMode } from "@/lib/zen-mode";

function consume(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

export function handleDockShortcut(event: KeyboardEvent): boolean {
  // A focused terminal keeps the keys it can send (Shift+F11).
  if (terminalOwnsKey(event)) return false;
  const bindings = useShortcutStore.getState().bindings;
  const settings = useSettingsStore.getState();
  if (matchesShortcut(event, bindings.toggleTerminal)) {
    event.preventDefault();
    event.stopPropagation();
    settings.setTerminalOpen(!settings.terminalOpen);
    return true;
  }
  if (matchesShortcut(event, bindings.toggleZenMode)) {
    event.preventDefault();
    event.stopPropagation();
    toggleZenMode();
    return true;
  }
  return false;
}

/**
 * Terminal tab shortcuts. New terminal works anywhere; next, previous and
 * close act only while focus is inside the terminal dock.
 */
export function handleTerminalTabShortcut(event: KeyboardEvent): boolean {
  const bindings = useShortcutStore.getState().bindings;
  if (matchesShortcut(event, bindings.newTerminal)) {
    consume(event);
    openNewTerminal();
    return true;
  }
  if (!isInsideTerminalDock(event.target)) return false;
  // Off macOS a focused terminal keeps Ctrl+PageDown and Ctrl+PageUp (vim's tab keys).
  if (terminalOwnsKey(event)) return false;
  if (matchesShortcut(event, bindings.nextTerminal)) {
    consume(event);
    useTerminalsStore.getState().activateRelativeTerminal(1);
    return true;
  }
  if (matchesShortcut(event, bindings.previousTerminal)) {
    consume(event);
    useTerminalsStore.getState().activateRelativeTerminal(-1);
    return true;
  }
  if (matchesShortcut(event, bindings.closeTerminal)) {
    const activeId = useTerminalsStore.getState().activeId;
    if (!activeId) return false;
    consume(event);
    void import("@/lib/terminal-lifecycle")
      .then((lifecycle) =>
        lifecycle.requestCloseTerminals([activeId], () => lifecycle.closeTerminalTabs([activeId])),
      )
      .catch((error: unknown) => logError("close terminal from shortcut", error));
    return true;
  }
  return false;
}
