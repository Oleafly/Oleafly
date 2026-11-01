import {
  isCtrlTerminalKey,
  isTerminalTarget,
  terminalClaimsKey,
  terminalPlatform,
  type TerminalKeyEvent,
} from "@/lib/terminal-keys";
import { useSettingsStore } from "@/store/settings";
import { matchesShortcut, type ShortcutId, useShortcutStore } from "@/store/shortcuts";

export const TERMINAL_APP_SHORTCUTS: readonly ShortcutId[] = [
  "toggleTerminal",
  "commandPalette",
  "openSettings",
  "newTerminal",
  "closeTerminal",
  "nextTerminal",
  "previousTerminal",
];

export function isAllowListedTerminalShortcut(event: TerminalKeyEvent): boolean {
  if (terminalPlatform() !== "mac" && isCtrlTerminalKey(event)) return false;
  const bindings = useShortcutStore.getState().bindings;
  const keyboardEvent = event as unknown as KeyboardEvent;
  return TERMINAL_APP_SHORTCUTS.some((id) => matchesShortcut(keyboardEvent, bindings[id]));
}

export function terminalOwnsKey(event: KeyboardEvent): boolean {
  if (!isTerminalTarget(event.target)) return false;
  const settings = useSettingsStore.getState();
  return terminalClaimsKey(event, {
    platform: terminalPlatform(),
    shiftEnter: settings.terminalShiftEnter,
    wsl: false,
    hasSelection: false,
    optionIsMeta: settings.terminalOptionIsMeta,
    isAppShortcut: isAllowListedTerminalShortcut,
  });
}
