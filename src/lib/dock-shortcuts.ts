import { useSettingsStore } from "@/store/settings";
import { toggleBrowser } from "@/lib/browser-window";
import { matchesShortcut, useShortcutStore } from "@/store/shortcuts";
import { toggleZenMode } from "@/lib/zen-mode";

export function handleDockShortcut(event: KeyboardEvent): boolean {
  const bindings = useShortcutStore.getState().bindings;
  const settings = useSettingsStore.getState();
  if (matchesShortcut(event, bindings.toggleTerminal)) {
    event.preventDefault();
    event.stopPropagation();
    settings.setTerminalOpen(!settings.terminalOpen);
    return true;
  }
  if (matchesShortcut(event, bindings.toggleBrowser)) {
    const target = event.target as Partial<Pick<Element, "closest">> | null;
    if (target?.closest?.(".ProseMirror")) return false;
    event.preventDefault();
    event.stopPropagation();
    toggleBrowser();
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
