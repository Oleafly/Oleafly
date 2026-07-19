import { create } from "zustand";

export type ShortcutId =
  | "recompile"
  | "commandPalette"
  | "searchDocuments"
  | "forwardSync"
  | "shortcutReference";

export interface ShortcutBinding {
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface ShortcutDefinition {
  id: ShortcutId;
  label: string;
  description: string;
  category: string;
  defaultBinding: ShortcutBinding;
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  {
    id: "recompile",
    label: "Recompile",
    description: "Compile the current project and reveal its PDF.",
    category: "Compile",
    defaultBinding: { key: "Enter", mod: true },
  },
  {
    id: "commandPalette",
    label: "Command palette",
    description: "Search and run Oleafly commands.",
    category: "Navigation",
    defaultBinding: { key: "k", mod: true },
  },
  {
    id: "searchDocuments",
    label: "Search all documents",
    description: "Search across projects and documents.",
    category: "Navigation",
    defaultBinding: { key: "f", mod: true, shift: true },
  },
  {
    id: "forwardSync",
    label: "Go to PDF",
    description: "Jump from the editor cursor to the compiled PDF.",
    category: "Navigation",
    defaultBinding: { key: "j", mod: true, shift: true },
  },
  {
    id: "shortcutReference",
    label: "Shortcut reference",
    description: "Open the project shortcut reference.",
    category: "Settings",
    defaultBinding: { key: "/", mod: true },
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
  const mod = apple ? event.metaKey : event.ctrlKey;
  const otherPlatformMod = apple ? event.ctrlKey : event.metaKey;
  return (
    event.key.toLowerCase() === binding.key.toLowerCase() &&
    mod === Boolean(binding.mod) &&
    !otherPlatformMod &&
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
  return {
    key: event.key.length === 1 ? event.key.toLowerCase() : event.key,
    mod: event.metaKey || event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
  };
}

export function reservedShortcutLabel(binding: ShortcutBinding): string | null {
  if (!binding.mod || binding.alt || binding.shift) return null;
  const reserved: Record<string, string> = {
    a: "Select all",
    c: "Copy",
    q: "Quit",
    s: "Save",
    v: "Paste",
    w: "Close window",
    x: "Cut",
    " ": "System search",
    space: "System search",
  };
  return reserved[binding.key.toLowerCase()] ?? null;
}

export function sameShortcutBinding(left: ShortcutBinding, right: ShortcutBinding): boolean {
  return (
    left.key.toLowerCase() === right.key.toLowerCase() &&
    Boolean(left.mod) === Boolean(right.mod) &&
    Boolean(left.shift) === Boolean(right.shift) &&
    Boolean(left.alt) === Boolean(right.alt)
  );
}

export function shortcutLabel(binding: ShortcutBinding): string {
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const parts: string[] = [];
  if (binding.mod) parts.push(mac ? "⌘" : "Ctrl");
  if (binding.shift) parts.push(mac ? "⇧" : "Shift");
  if (binding.alt) parts.push(mac ? "⌥" : "Alt");
  const key = binding.key === " " ? "Space" : binding.key;
  parts.push(key.length === 1 ? key.toUpperCase() : key);
  return mac ? parts.join("") : parts.join("+");
}
