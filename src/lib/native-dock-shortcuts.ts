import { useEffect } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useTourStore } from "@/store/tours";
import { toggleBrowser } from "@/lib/browser-window";
import {
  SHORTCUT_DEFINITIONS,
  type ShortcutBinding,
  type ShortcutId,
  useShortcutStore,
} from "@/store/shortcuts";

const NATIVE_KEY_NAMES: Record<string, string> = {
  "!": "Digit1",
  "@": "Digit2",
  "#": "Digit3",
  "$": "Digit4",
  "%": "Digit5",
  "^": "Digit6",
  "&": "Digit7",
  "*": "Digit8",
  "(": "Digit9",
  ")": "Digit0",
  "+": "Equal",
  _: "Minus",
  "{": "BracketLeft",
  "}": "BracketRight",
  "?": "Slash",
  "~": "Backquote",
  ":": "Semicolon",
  '"': "Quote",
  "|": "Backslash",
  "<": "Comma",
  ">": "Period",
};

function isApplePlatform(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform)
  );
}

export function usesNativeDockMenu(
  tauri = isTauri(),
  platform = typeof navigator !== "undefined" ? navigator.platform : "",
): boolean {
  return tauri && /Mac/.test(platform);
}

const NATIVE_CHARACTER_KEYS = /^[A-Z0-9`\\[\],=\-.';/]$/;
const NATIVE_NAMED_KEYS = new Set(
  [
    "Backquote",
    "Backslash",
    "BracketLeft",
    "BracketRight",
    "Comma",
    "Equal",
    "Minus",
    "Period",
    "Quote",
    "Semicolon",
    "Slash",
    "Backspace",
    "CapsLock",
    "Enter",
    "Space",
    "Tab",
    "Delete",
    "End",
    "Home",
    "Insert",
    "PageDown",
    "PageUp",
    "PrintScreen",
    "ScrollLock",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "Down",
    "Left",
    "Right",
    "Up",
    "NumLock",
    "NumpadAdd",
    "NumpadDecimal",
    "NumpadDivide",
    "NumpadEnter",
    "NumpadEqual",
    "NumpadMultiply",
    "NumpadSubtract",
    "Escape",
    "Esc",
    "AudioVolumeDown",
    "AudioVolumeUp",
    "AudioVolumeMute",
    ...Array.from({ length: 10 }, (_, digit) => [`Digit${digit}`, `Numpad${digit}`]).flat(),
    ...Array.from({ length: 26 }, (_, letter) => `Key${String.fromCodePoint(65 + letter)}`),
    ...Array.from({ length: 24 }, (_, index) => `F${index + 1}`),
  ].map((name) => name.toUpperCase()),
);

export function isNativeAcceleratorKey(key: string): boolean {
  const upper = key.toUpperCase();
  return key.length === 1 ? NATIVE_CHARACTER_KEYS.test(upper) : NATIVE_NAMED_KEYS.has(upper);
}

export const NATIVE_MENU_SHORTCUTS: ReadonlySet<ShortcutId> = new Set([
  "toggleTerminal",
  "toggleBrowser",
  "openFolder",
  "openSettings",
]);

export function nativeAccelerator(
  binding: ShortcutBinding,
  apple = isApplePlatform(),
): string | null {
  const modifiers = new Set<string>();
  if (binding.mod) modifiers.add(apple ? "Cmd" : "Ctrl");
  if (binding.ctrl) modifiers.add("Ctrl");
  if (binding.shift) modifiers.add("Shift");
  if (binding.alt) modifiers.add("Alt");
  const key =
    NATIVE_KEY_NAMES[binding.key] ??
    (binding.key === " " ? "Space" : binding.key);
  if (!isNativeAcceleratorKey(key)) return null;
  return [...modifiers, key.length === 1 ? key.toUpperCase() : key].join("+");
}

function nativeAcceleratorFor(id: ShortcutId): string {
  const bindings = useShortcutStore.getState().bindings;
  const fallback = SHORTCUT_DEFINITIONS.find((definition) => definition.id === id)?.defaultBinding;
  return (
    nativeAccelerator(bindings[id]) ??
    (fallback ? nativeAccelerator(fallback) : null) ??
    ""
  );
}

export async function pauseNativeShortcuts(paused: boolean): Promise<void> {
  if (!usesNativeDockMenu()) return;
  await invoke("set_native_shortcuts_paused", { paused });
}

export function useNativeShortcutsPaused(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const report = (error: unknown) => console.error("Failed to pause menu shortcuts", error);
    void pauseNativeShortcuts(true).catch(report);
    return () => {
      void pauseNativeShortcuts(false).catch(report);
    };
  }, [active]);
}

function toggleDock(dock: "terminal" | "browser"): void {
  if (!useFilesStore.getState().projectId || useTourStore.getState().activeTourId) return;
  if (dock === "terminal") {
    const settings = useSettingsStore.getState();
    settings.setTerminalOpen(!settings.terminalOpen);
  } else {
    toggleBrowser();
  }
}

function syncNativeAccelerators(): Promise<void> {
  return invoke("set_dock_shortcut_accelerators", {
    terminalAccelerator: nativeAcceleratorFor("toggleTerminal"),
    browserAccelerator: nativeAcceleratorFor("toggleBrowser"),
    openFolderAccelerator: nativeAcceleratorFor("openFolder"),
    settingsAccelerator: nativeAcceleratorFor("openSettings"),
  });
}

export async function startNativeDockShortcutBridge(): Promise<() => void> {
  if (!usesNativeDockMenu()) return () => {};
  let syncQueue = Promise.resolve();
  const sync = () => {
    syncQueue = syncQueue
      .then(syncNativeAccelerators)
      .catch((error) => console.error("Failed to sync dock shortcuts", error));
    return syncQueue;
  };
  const unsubscribeStore = useShortcutStore.subscribe((state, previous) => {
    if ([...NATIVE_MENU_SHORTCUTS].some((id) => state.bindings[id] !== previous.bindings[id])) {
      void sync();
    }
  });
  await sync();
  const unlistenTerminal = await listen("menu://toggle-terminal", () => {
    toggleDock("terminal");
  });
  const unlistenBrowser = await listen("menu://toggle-browser", () => {
    toggleDock("browser");
  });
  return () => {
    unsubscribeStore();
    unlistenTerminal();
    unlistenBrowser();
  };
}
