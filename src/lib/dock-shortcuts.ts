import { useSettingsStore } from "@/store/settings";
import { matchesShortcut, useShortcutStore } from "@/store/shortcuts";

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
    event.preventDefault();
    event.stopPropagation();
    settings.setBrowserOpen(!settings.browserOpen);
    return true;
  }
  return false;
}
