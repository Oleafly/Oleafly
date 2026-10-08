import { create } from "zustand";
import { isAltGraphCharacter, isUnbindableKey } from "@/lib/keyboard";
import { readJson, writeJson } from "@/lib/local-storage";

export type ShortcutId =
  | "recompile"
  | "commandPalette"
  | "searchDocuments"
  | "forwardSync"
  | "shortcutReference"
  | "toggleTerminal"
  | "toggleBrowser"
  | "toggleSidebar"
  | "toggleZenMode"
  | "openFolder"
  | "openSettings";

export interface ShortcutBinding {
  key: string;
  mod?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface ShortcutDefinition {
  id: ShortcutId;
  defaultBinding: ShortcutBinding;
}

const BROWSER_BINDING: ShortcutBinding = { key: "b", ctrl: true, shift: true };
const LINUX_BROWSER_BINDING: ShortcutBinding = { key: "b", ctrl: true, alt: true };

const ZEN_MAC_BINDING: ShortcutBinding = { key: "f", mod: true, ctrl: true, shift: true };
const ZEN_BINDING: ShortcutBinding = { key: "F11", shift: true };
const FUNCTION_KEY = /^F(?:[1-9]|1\d|2[0-4])$/;

function onApplePlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

function onLinuxDesktop(): boolean {
  const tauri = Boolean((globalThis as { isTauri?: unknown }).isTauri);
  return tauri && typeof navigator !== "undefined" && /Linux/.test(navigator.platform);
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  {
    id: "recompile",
    defaultBinding: { key: "Enter", mod: true },
  },
  {
    id: "commandPalette",
    defaultBinding: { key: "k", mod: true },
  },
  {
    id: "searchDocuments",
    defaultBinding: { key: "f", mod: true, shift: true },
  },
  {
    id: "forwardSync",
    defaultBinding: { key: "j", mod: true, shift: true },
  },
  {
    id: "shortcutReference",
    defaultBinding: { key: "/", mod: true },
  },
  {
    id: "toggleTerminal",
    defaultBinding: { key: "`", ctrl: true },
  },
  {
    id: "toggleBrowser",
    get defaultBinding() {
      return onLinuxDesktop() ? LINUX_BROWSER_BINDING : BROWSER_BINDING;
    },
  },
  {
    id: "toggleSidebar",
    defaultBinding: { key: "b", mod: true },
  },
  {
    id: "toggleZenMode",
    get defaultBinding() {
      return onApplePlatform() ? ZEN_MAC_BINDING : ZEN_BINDING;
    },
  },
  {
    id: "openFolder",
    defaultBinding: { key: "o", mod: true, shift: true },
  },
  {
    id: "openSettings",
    defaultBinding: { key: ",", mod: true },
  },
];

type ShortcutBindings = Record<ShortcutId, ShortcutBinding>;

function defaultBindings(): ShortcutBindings {
  return Object.fromEntries(
    SHORTCUT_DEFINITIONS.map((definition) => [definition.id, definition.defaultBinding]),
  ) as ShortcutBindings;
}

export function shortcutsDifferFromDefaults(bindings: ShortcutBindings): boolean {
  const defaults = defaultBindings();
  return SHORTCUT_DEFINITIONS.some(({ id }) => !sameShortcutBinding(bindings[id], defaults[id]));
}

function isRetiredDefault(id: ShortcutId, binding: ShortcutBinding): boolean {
  return id === "toggleBrowser" && onLinuxDesktop() && sameShortcutBinding(binding, BROWSER_BINDING);
}

function isValidBinding(value: unknown): value is ShortcutBinding {
  if (!value || typeof value !== "object") return false;
  const { key, mod, ctrl } = value as { key?: unknown; mod?: unknown; ctrl?: unknown };
  return (
    typeof key === "string" &&
    key !== "" &&
    !isUnbindableKey(key) &&
    Boolean(mod || ctrl || FUNCTION_KEY.test(key))
  );
}

function storedBindings(value: unknown): ShortcutBindings {
  const defaults = defaultBindings();
  const parsed = value as Record<string, unknown>;
  const clean: Partial<ShortcutBindings> = {};
  for (const id of Object.keys(defaults) as ShortcutId[]) {
    const binding = parsed[id];
    if (isValidBinding(binding) && !isRetiredDefault(id, binding)) clean[id] = binding;
  }
  return { ...defaults, ...clean };
}

function loadBindings(): ShortcutBindings {
  return readJson("oleafly.shortcuts", defaultBindings(), storedBindings);
}

function saveBindings(bindings: ShortcutBindings) {
  writeJson("oleafly.shortcuts", bindings);
}

interface ShortcutState {
  bindings: ShortcutBindings;
  setBinding: (id: ShortcutId, binding: ShortcutBinding) => void;
  resetBinding: (id: ShortcutId) => void;
  resetAll: () => void;
}

export const useShortcutStore = create<ShortcutState>((set) => ({
  bindings: loadBindings(),
  setBinding: (id, binding) =>
    set((state) => {
      const bindings = { ...state.bindings, [id]: binding };
      saveBindings(bindings);
      return { bindings };
    }),
  resetBinding: (id) =>
    set((state) => {
      const bindings = { ...state.bindings, [id]: defaultBindings()[id] };
      saveBindings(bindings);
      return { bindings };
    }),
  resetAll: () => {
    const defaults = defaultBindings();
    saveBindings(defaults);
    set({ bindings: defaults });
  },
}));

export function matchesShortcut(event: KeyboardEvent, binding: ShortcutBinding): boolean {
  if (isAltGraphCharacter(event)) return false;
  const apple =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const ctrl = Boolean(binding.ctrl) || (!apple && Boolean(binding.mod));
  const meta = apple && Boolean(binding.mod);
  return (
    event.key.toLowerCase() === binding.key.toLowerCase() &&
    event.ctrlKey === ctrl &&
    event.metaKey === meta &&
    event.shiftKey === Boolean(binding.shift) &&
    event.altKey === Boolean(binding.alt)
  );
}

export function bindingFromEvent(event: KeyboardEvent): ShortcutBinding | null {
  if (
    (!event.metaKey && !event.ctrlKey && !FUNCTION_KEY.test(event.key)) ||
    isUnbindableKey(event.key) ||
    event.key === "Tab" ||
    event.key === "Escape" ||
    isAltGraphCharacter(event)
  ) {
    return null;
  }
  const apple =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return {
    key: event.key.length === 1 ? event.key.toLowerCase() : event.key,
    ...(event.metaKey || (event.ctrlKey && !apple) ? { mod: true } : {}),
    ...(event.ctrlKey && apple ? { ctrl: true } : {}),
    shift: event.shiftKey,
    alt: event.altKey,
  };
}

export type ReservedShortcutAction =
  | "closeWindow"
  | "copy"
  | "cut"
  | "hide"
  | "minimize"
  | "paste"
  | "quit"
  | "save"
  | "selectAll"
  | "systemSearch"
  | "windowSwitching";

export function reservedShortcutAction(binding: ShortcutBinding): ReservedShortcutAction | null {
  const apple =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const primaryModifier = apple
    ? Boolean(binding.mod) && !binding.ctrl
    : Boolean(binding.mod || binding.ctrl);
  if (!primaryModifier || binding.alt || binding.shift) return null;
  if (apple && binding.key === "`") return "windowSwitching";
  const reserved: Record<string, ReservedShortcutAction> = {
    a: "selectAll",
    c: "copy",
    q: "quit",
    s: "save",
    v: "paste",
    w: "closeWindow",
    x: "cut",
    " ": "systemSearch",
    space: "systemSearch",
    ...(apple ? { h: "hide", m: "minimize" } : {}),
  };
  return reserved[binding.key.toLowerCase()] ?? null;
}

export function sameShortcutBinding(left: ShortcutBinding, right: ShortcutBinding): boolean {
  const apple =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const leftCtrl = Boolean(left.ctrl) || (!apple && Boolean(left.mod));
  const rightCtrl = Boolean(right.ctrl) || (!apple && Boolean(right.mod));
  const leftMeta = apple && Boolean(left.mod);
  const rightMeta = apple && Boolean(right.mod);
  return (
    left.key.toLowerCase() === right.key.toLowerCase() &&
    leftCtrl === rightCtrl &&
    leftMeta === rightMeta &&
    Boolean(left.shift) === Boolean(right.shift) &&
    Boolean(left.alt) === Boolean(right.alt)
  );
}

function onMacKeyboard(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

export function shortcutParts(binding: ShortcutBinding): string[] {
  const mac = onMacKeyboard();
  const parts: string[] = [];
  if (binding.mod) parts.push(mac ? "⌘" : "Ctrl");
  if (binding.ctrl && (mac || !binding.mod)) parts.push("Ctrl");
  if (binding.shift) parts.push(mac ? "⇧" : "Shift");
  if (binding.alt) parts.push(mac ? "⌥" : "Alt");
  const key = binding.key === " " ? "Space" : binding.key;
  parts.push(key.length === 1 ? key.toUpperCase() : key);
  return parts;
}

export function shortcutLabel(binding: ShortcutBinding): string {
  return shortcutParts(binding).join(onMacKeyboard() ? "" : "+");
}
