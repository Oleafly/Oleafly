import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { launchBrowser } from "@/lib/browser-window";
import {
  type ShortcutBinding,
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
  return tauri && /Mac|Linux/.test(platform);
}

export function nativeAccelerator(
  binding: ShortcutBinding,
  apple = isApplePlatform(),
): string {
  const modifiers = new Set<string>();
  if (binding.mod) modifiers.add(apple ? "Cmd" : "Ctrl");
  if (binding.ctrl) modifiers.add("Ctrl");
  if (binding.shift) modifiers.add("Shift");
  if (binding.alt) modifiers.add("Alt");
  const key =
    NATIVE_KEY_NAMES[binding.key] ??
    (binding.key === " " ? "Space" : binding.key);
  return [...modifiers, key.length === 1 ? key.toUpperCase() : key].join("+");
}

function toggleDock(dock: "terminal" | "browser"): void {
  if (!useFilesStore.getState().projectId) return;
  if (dock === "terminal") {
    const settings = useSettingsStore.getState();
    settings.setTerminalOpen(!settings.terminalOpen);
  } else {
    launchBrowser();
  }
}

function syncNativeAccelerators(): Promise<void> {
  const bindings = useShortcutStore.getState().bindings;
  return invoke("set_dock_shortcut_accelerators", {
    terminalAccelerator: nativeAccelerator(bindings.toggleTerminal),
    browserAccelerator: nativeAccelerator(bindings.toggleBrowser),
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
    if (
      state.bindings.toggleTerminal !== previous.bindings.toggleTerminal ||
      state.bindings.toggleBrowser !== previous.bindings.toggleBrowser
    ) {
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
