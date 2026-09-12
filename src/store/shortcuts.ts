import { create } from "zustand";

export type ShortcutId =
  | "recompile"
  | "commandPalette"
  | "searchDocuments"
  | "forwardSync"
  | "shortcutReference"
  | "toggleTerminal"
  | "toggleBrowser"
  | "toggleSidebar";

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
    defaultBinding: { key: "b", ctrl: true, shift: true },
  },
  {
    id: "toggleSidebar",
    defaultBinding: { key: "b", mod: true },
  },
];

type ShortcutBindings = Record<ShortcutId, ShortcutBinding>;

const defaults = Object.fromEntries(
  SHORTCUT_DEFINITIONS.map((definition) => [definition.id, definition.defaultBinding]),
) as ShortcutBindings;

function isValidBinding(value: unknown): value is ShortcutBinding {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { key?: unknown }).key === "string"
  );
}

function loadBindings(): ShortcutBindings {
  try {
    const value = localStorage.getItem("oleafly.shortcuts");
    if (!value) return defaults;
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const clean: Partial<ShortcutBindings> = {};
    for (const id of Object.keys(defaults) as ShortcutId[]) {
      if (isValidBinding(parsed[id])) clean[id] = parsed[id] as ShortcutBinding;
    }
    return { ...defaults, ...clean };
  } catch {
    return defaults;
  }
}

function saveBindings(bindings: ShortcutBindings) {
  try {
    localStorage.setItem("oleafly.shortcuts", JSON.stringify(bindings));
  } catch {}
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
      const bindings = { ...state.bindings, [id]: defaults[id] };
      saveBindings(bindings);
      return { bindings };
    }),
  resetAll: () => {
    saveBindings(defaults);
    set({ bindings: defaults });
  },
}));

export function matchesShortcut(event: KeyboardEvent, binding: ShortcutBinding): boolean {
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
    !event.metaKey &&
    !event.ctrlKey ||
    ["Shift", "Control", "Meta", "Alt", "Tab", "Escape"].includes(event.key)
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

export function shortcutLabel(binding: ShortcutBinding): string {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const parts: string[] = [];
  if (binding.mod) parts.push(mac ? "⌘" : "Ctrl");
  if (binding.ctrl && (mac || !binding.mod)) parts.push("Ctrl");
  if (binding.shift) parts.push(mac ? "⇧" : "Shift");
  if (binding.alt) parts.push(mac ? "⌥" : "Alt");
  const key = binding.key === " " ? "Space" : binding.key;
  parts.push(key.length === 1 ? key.toUpperCase() : key);
  return mac ? parts.join("") : parts.join("+");
}
