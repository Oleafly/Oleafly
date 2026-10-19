// Which keys the app's capture-phase shortcut handlers must leave to a
// focused terminal. Runs on every keydown, so it does one DOM lookup first
// and only reads the stores for keys pressed inside an xterm.
import {
  isTerminalTarget,
  terminalClaimsKey,
  terminalPlatform,
  type TerminalKeyEvent,
} from "@/lib/terminal-keys";
import { useSettingsStore } from "@/store/settings";
import { matchesShortcut, type ShortcutId, useShortcutStore } from "@/store/shortcuts";

/** App shortcuts that still work while the terminal has focus. */
export const TERMINAL_APP_SHORTCUTS: readonly ShortcutId[] = [
  "toggleTerminal",
  "commandPalette",
  "openSettings",
  "newTerminal",
  "closeTerminal",
  "nextTerminal",
  "previousTerminal",
];

/** Whether the key is one of the allow-listed app shortcuts, by the current bindings. */
export function isAllowListedTerminalShortcut(event: TerminalKeyEvent): boolean {
  const bindings = useShortcutStore.getState().bindings;
  // matchesShortcut reads getModifierState when the event has it (AltGr).
  const keyboardEvent = event as unknown as KeyboardEvent;
  return TERMINAL_APP_SHORTCUTS.some((id) => matchesShortcut(keyboardEvent, bindings[id]));
}

/** True when a focused terminal should get this key instead of an app shortcut. */
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
