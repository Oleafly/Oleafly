import { create } from "zustand";
import { isAltGraphCharacter, isUnbindableKey, keyLabel } from "@/lib/keyboard";
import { readJson, writeJson } from "@/lib/local-storage";

export type ShortcutId =
  | "recompile"
  | "commandPalette"
  | "searchDocuments"
  | "forwardSync"
  | "shortcutReference"
  | "toggleTerminal"
  | "newTerminal"
  | "closeTerminal"
  | "nextTerminal"
  | "previousTerminal"
  | "toggleSidebar"
  | "togglePreview"
  | "toggleZenMode"
  | "openFolder"
  | "openSettings"
  | "zoomIn"
  | "zoomOut"
  | "resetZoom"
  | "notesQuickSwitcher"
  | "notesTodayNote"
  | "notesGraph"
  | "notesLocalGraph"
  | "notesOutline"
  | "notesAskAgent"
  | "notesNewNote"
  | "notesSearch"
  | "notesBookmark"
  | "notesCopyLink"
  | "notesProperties"
  | "notesQuickCapture"
  | "notesCopyBlockLink"
  | "notesBack"
  | "notesForward";

export interface ShortcutBinding {
  key: string;
  mod?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

type ShortcutScope = "notes";

export interface ShortcutDefinition {
  id: ShortcutId;
  defaultBinding: ShortcutBinding;
  scope?: ShortcutScope;
}

const FUNCTION_KEY = /^F(?:[1-9]|1\d|2[0-4])$/;
const ALT_ARROW_KEY = /^Arrow(?:Left|Right|Up|Down)$/;

function onApplePlatform(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

function platformDefault(
  id: ShortcutId,
  apple: ShortcutBinding,
  other: ShortcutBinding,
  scope?: ShortcutScope,
): ShortcutDefinition {
  return {
    id,
    get defaultBinding() {
      return onApplePlatform() ? apple : other;
    },
    ...(scope ? { scope } : {}),
  };
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
    id: "newTerminal",
    defaultBinding: { key: "~", ctrl: true, shift: true },
  },
  {
    id: "closeTerminal",
    defaultBinding: { key: "w", ctrl: true, shift: true },
  },
  {
    id: "nextTerminal",
    defaultBinding: { key: "PageDown", ctrl: true },
  },
  {
    id: "previousTerminal",
    defaultBinding: { key: "PageUp", ctrl: true },
  },
  {
    id: "toggleSidebar",
    defaultBinding: { key: "b", mod: true },
  },
  {
    id: "togglePreview",
    defaultBinding: { key: "p", mod: true, alt: true },
  },
  platformDefault("toggleZenMode", { key: "f", mod: true, ctrl: true, shift: true }, { key: "F11", shift: true }),
  {
    id: "openFolder",
    defaultBinding: { key: "o", mod: true, shift: true },
  },
  {
    id: "openSettings",
    defaultBinding: { key: ",", mod: true },
  },
  {
    id: "zoomIn",
    defaultBinding: { key: "=", mod: true },
  },
  {
    id: "zoomOut",
    defaultBinding: { key: "-", mod: true },
  },
  {
    id: "resetZoom",
    defaultBinding: { key: "0", mod: true },
  },
  {
    id: "notesQuickSwitcher",
    defaultBinding: { key: "o", mod: true },
    scope: "notes",
  },
  {
    id: "notesTodayNote",
    defaultBinding: { key: "d", mod: true, shift: true },
    scope: "notes",
  },
  {
    id: "notesGraph",
    defaultBinding: { key: "g", mod: true, shift: true },
    scope: "notes",
  },
  platformDefault("notesLocalGraph", { key: "g", mod: true, alt: true }, { key: "m", mod: true, shift: true }, "notes"),
  platformDefault("notesOutline", { key: "o", mod: true, alt: true }, { key: "k", mod: true, shift: true }, "notes"),
  {
    id: "notesAskAgent",
    defaultBinding: { key: "j", mod: true },
    scope: "notes",
  },
  platformDefault("notesNewNote", { key: "n", mod: true, alt: true }, { key: "n", mod: true, shift: true }, "notes"),
  platformDefault("notesSearch", { key: "f", mod: true, alt: true }, { key: "a", mod: true, shift: true }, "notes"),
  platformDefault("notesBookmark", { key: "b", mod: true, alt: true }, { key: "y", mod: true, shift: true }, "notes"),
  platformDefault("notesCopyLink", { key: "l", mod: true, alt: true }, { key: "x", mod: true, shift: true }, "notes"),
  platformDefault("notesProperties", { key: "i", mod: true, alt: true }, { key: "t", mod: true, shift: true }, "notes"),
  {
    id: "notesQuickCapture",
    defaultBinding: { key: " ", mod: true, shift: true, alt: true },
    scope: "notes",
  },
  {
    id: "notesCopyBlockLink",
    defaultBinding: { key: "l", mod: true, shift: true },
    scope: "notes",
  },
  platformDefault("notesBack", { key: "[", mod: true }, { key: "ArrowLeft", alt: true }, "notes"),
  platformDefault("notesForward", { key: "]", mod: true }, { key: "ArrowRight", alt: true }, "notes"),
];

type ShortcutBindings = Record<ShortcutId, ShortcutBinding>;

const SHORTCUTS_WITHOUT_NOTES = SHORTCUT_DEFINITIONS.filter((definition) => definition.scope !== "notes");

export function shortcutDefinitionsInEffect(notes: boolean): readonly ShortcutDefinition[] {
  return notes ? SHORTCUT_DEFINITIONS : SHORTCUTS_WITHOUT_NOTES;
}

function defaultBindings(): ShortcutBindings {
  return Object.fromEntries(
    SHORTCUT_DEFINITIONS.map((definition) => [definition.id, definition.defaultBinding]),
  ) as ShortcutBindings;
}

export function shortcutsDifferFromDefaults(bindings: ShortcutBindings): boolean {
  const defaults = defaultBindings();
  return SHORTCUT_DEFINITIONS.some(({ id }) => !sameShortcutBinding(bindings[id], defaults[id]));
}

export function isValidBinding(value: unknown): value is ShortcutBinding {
  if (!value || typeof value !== "object") return false;
  const { key, mod, ctrl, alt } = value as { key?: unknown; mod?: unknown; ctrl?: unknown; alt?: unknown };
  return (
    typeof key === "string" &&
    key !== "" &&
    !isUnbindableKey(key) &&
    Boolean(mod || ctrl || FUNCTION_KEY.test(key) || (alt && ALT_ARROW_KEY.test(key)))
  );
}

function storedBindings(value: unknown): ShortcutBindings {
  const defaults = defaultBindings();
  const parsed = value as Record<string, unknown>;
  const clean: Partial<ShortcutBindings> = {};
  for (const id of Object.keys(defaults) as ShortcutId[]) {
    const binding = parsed[id];
    if (isValidBinding(binding)) clean[id] = binding;
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

const PHYSICAL_KEY = /^(?:Key([A-Z])|Digit(\d))$/;
const PRINTABLE_ASCII = /^[\x20-\x7e]$/;
const NON_LATIN_CHARACTER = /^(?![\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}])[\p{L}\p{Nd}]$/u;

function physicalKey(event: KeyboardEvent): string | null {
  const match = PHYSICAL_KEY.exec(event.code ?? "");
  return match ? (match[1] ?? match[2]).toLowerCase() : null;
}

function optionLevelKey(event: KeyboardEvent, apple: boolean): string | null {
  if (!apple || !event.altKey) return null;
  if (event.key !== "Dead" && (event.key.length !== 1 || PRINTABLE_ASCII.test(event.key))) return null;
  return physicalKey(event);
}

function nonLatinLayoutKey(event: KeyboardEvent): string | null {
  return NON_LATIN_CHARACTER.test(event.key ?? "") ? physicalKey(event) : null;
}

function isBackquoteBinding(key: string): boolean {
  return key === "`" || key === "~";
}

export function matchesShortcut(event: KeyboardEvent, binding: ShortcutBinding): boolean {
  if (isAltGraphCharacter(event)) return false;
  const apple =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const ctrl = Boolean(binding.ctrl) || (!apple && Boolean(binding.mod));
  const meta = apple && Boolean(binding.mod);
  const key = binding.key.toLowerCase();
  const physicalBackquote = isBackquoteBinding(key) && event.code === "Backquote";
  return (
    (event.key.toLowerCase() === key ||
      optionLevelKey(event, apple) === key ||
      nonLatinLayoutKey(event) === key ||
      physicalBackquote) &&
    event.ctrlKey === ctrl &&
    event.metaKey === meta &&
    event.shiftKey === Boolean(binding.shift) &&
    event.altKey === Boolean(binding.alt)
  );
}

function bindingKey(event: KeyboardEvent, apple: boolean): string {
  if (event.code === "Backquote") return event.shiftKey ? "~" : "`";
  const physical = optionLevelKey(event, apple) ?? nonLatinLayoutKey(event);
  if (physical) return physical;
  return event.key.length === 1 ? event.key.toLowerCase() : event.key;
}

export function bindingFromEvent(event: KeyboardEvent): ShortcutBinding | null {
  const apple =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  if (
    (!event.metaKey && !event.ctrlKey && !FUNCTION_KEY.test(event.key) && !(event.altKey && ALT_ARROW_KEY.test(event.key))) ||
    (isUnbindableKey(event.key) && !optionLevelKey(event, apple)) ||
    event.key === "Tab" ||
    event.key === "Escape" ||
    isAltGraphCharacter(event)
  ) {
    return null;
  }
  return {
    key: bindingKey(event, apple),
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
  parts.push(binding.key === " " ? "Space" : keyLabel(binding.key));
  return parts;
}

export function shortcutLabel(binding: ShortcutBinding): string {
  return shortcutParts(binding).join(onMacKeyboard() ? "" : "+");
}
