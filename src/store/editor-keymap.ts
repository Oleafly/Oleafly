import { create } from "zustand";
import { EDITOR_COMMAND_IDS, type EditorCommandId } from "@oleafly/editor";

export type EditorKeyId = EditorCommandId;

export interface EditorKeyDefinition {
  id: EditorKeyId;
  defaultKey: string;
}

export const EDITOR_KEY_DEFINITIONS: readonly EditorKeyDefinition[] = [
  { id: "uppercase", defaultKey: "Ctrl-u" },
  { id: "lowercase", defaultKey: "Ctrl-Shift-u" },
  { id: "titleCase", defaultKey: "" },
  { id: "deleteLine", defaultKey: "Mod-d" },
  { id: "duplicate", defaultKey: "Mod-Shift-d" },
  { id: "addCursorAbove", defaultKey: "Ctrl-Alt-ArrowUp" },
  { id: "addCursorBelow", defaultKey: "Ctrl-Alt-ArrowDown" },
  { id: "gotoLine", defaultKey: "Mod-Shift-l" },
  { id: "toggleComment", defaultKey: "Mod-/" },
  { id: "selectNextOccurrence", defaultKey: "" },
  { id: "indentMore", defaultKey: "" },
  { id: "indentLess", defaultKey: "" },
];

export type EditorKeyBindings = Record<EditorKeyId, string>;

const MODIFIER_ORDER = ["Mod", "Cmd", "Ctrl", "Alt", "Shift"] as const;

const MODIFIER_ALIASES: Readonly<Record<string, (typeof MODIFIER_ORDER)[number]>> = {
  mod: "Mod",
  cmd: "Cmd",
  meta: "Cmd",
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
};

const NAMED_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Backspace",
  "Delete",
  "End",
  "Enter",
  "Escape",
  "Home",
  "Insert",
  "PageDown",
  "PageUp",
  "Space",
  "Tab",
]);

export interface ParsedEditorKey {
  modifiers: (typeof MODIFIER_ORDER)[number][];
  key: string;
}

function isFunctionKey(value: string): boolean {
  return /^F([1-9]|1[0-2])$/.test(value);
}

function isKeyName(value: string): boolean {
  if (value.length === 1) return value.trim().length === 1 || value === " ";
  return isFunctionKey(value) || NAMED_KEYS.has(value);
}

export function parseEditorKey(value: string): ParsedEditorKey | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/-(?!$)/);
  const key = parts.pop() ?? "";
  if (!isKeyName(key)) return null;
  const modifiers: (typeof MODIFIER_ORDER)[number][] = [];
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (!modifier || modifiers.includes(modifier)) return null;
    modifiers.push(modifier);
  }
  if (modifiers.length === 0 && !isFunctionKey(key)) return null;
  if (modifiers.includes("Mod") && modifiers.includes("Cmd")) return null;
  return { modifiers, key };
}

export function isValidEditorKey(value: string): boolean {
  return parseEditorKey(value) !== null;
}

export function normalizeEditorKey(value: string): string {
  const parsed = parseEditorKey(value);
  if (!parsed) return "";
  const ordered = MODIFIER_ORDER.filter((modifier) => parsed.modifiers.includes(modifier));
  const key = parsed.key.length === 1 ? parsed.key.toLowerCase() : parsed.key;
  return [...ordered, key].join("-");
}

export function sameEditorKey(left: string, right: string): boolean {
  if (!left || !right) return false;
  const effectiveKey = (value: string): string | null => {
    const parsed = parseEditorKey(normalizeEditorKey(value));
    if (!parsed) return null;
    const modifiers = new Set<string>(parsed.modifiers.map((modifier) =>
      modifier === "Mod" ? (isApple() ? "Cmd" : "Ctrl") : modifier,
    ));
    return [...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), parsed.key].join("-");
  };
  const normalized = effectiveKey(left);
  return normalized !== null && normalized === effectiveKey(right);
}

const APPLE_PLATFORM = /Mac|iPhone|iPad/;

function isApple(): boolean {
  return typeof navigator !== "undefined" && APPLE_PLATFORM.test(navigator.platform);
}

export function editorKeyFromEvent(event: KeyboardEvent): string | null {
  if (["Alt", "Control", "Meta", "Shift"].includes(event.key)) return null;
  const apple = isApple();
  const modifiers: string[] = [];
  if (event.metaKey && apple) modifiers.push("Mod");
  if (event.metaKey && !apple) modifiers.push("Cmd");
  if (event.ctrlKey) modifiers.push(apple ? "Ctrl" : "Mod");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  const key = event.key === " " ? "Space" : event.key;
  const named = key.length === 1 ? key.toLowerCase() : key;
  if (!isKeyName(named)) return null;
  const candidate = [...modifiers, named].join("-");
  return isValidEditorKey(candidate) ? normalizeEditorKey(candidate) : null;
}

const MODIFIER_LABELS: Readonly<Record<string, { mac: string; other: string }>> = {
  Mod: { mac: "⌘", other: "Ctrl" },
  Cmd: { mac: "⌘", other: "Win" },
  Ctrl: { mac: "Ctrl", other: "Ctrl" },
  Alt: { mac: "⌥", other: "Alt" },
  Shift: { mac: "Shift", other: "Shift" },
};

const KEY_LABELS: Readonly<Record<string, string>> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

export function editorKeyTokens(value: string): string[] {
  const parsed = parseEditorKey(value);
  if (!parsed) return [];
  const mac = isApple();
  const tokens = MODIFIER_ORDER.filter((modifier) => parsed.modifiers.includes(modifier)).map(
    (modifier) => (mac ? MODIFIER_LABELS[modifier].mac : MODIFIER_LABELS[modifier].other),
  );
  const key = parsed.key;
  tokens.push(KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key));
  return tokens;
}

export function editorKeyLabel(value: string): string {
  const tokens = editorKeyTokens(value);
  if (tokens.length === 0) return "";
  return isApple() ? tokens.join("") : tokens.join("+");
}

const defaults = Object.fromEntries(
  EDITOR_KEY_DEFINITIONS.map((definition) => [definition.id, definition.defaultKey]),
) as EditorKeyBindings;

export const EDITOR_KEY_DEFAULTS: Readonly<EditorKeyBindings> = defaults;

const STORAGE_KEY = "oleafly.editorKeymap";

export function mergeEditorKeys(raw: unknown): EditorKeyBindings {
  if (!raw || typeof raw !== "object") return { ...defaults };
  const parsed = raw as Record<string, unknown>;
  const clean: Partial<EditorKeyBindings> = {};
  for (const id of EDITOR_COMMAND_IDS) {
    const value = parsed[id];
    if (typeof value !== "string") continue;
    if (value === "") clean[id] = "";
    else if (isValidEditorKey(value)) clean[id] = normalizeEditorKey(value);
  }
  return { ...defaults, ...clean };
}

function loadBindings(): EditorKeyBindings {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return { ...defaults };
    return mergeEditorKeys(JSON.parse(value));
  } catch {
    return { ...defaults };
  }
}

function saveBindings(bindings: EditorKeyBindings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {}
}

interface EditorKeymapState {
  keys: EditorKeyBindings;
  setKey: (id: EditorKeyId, key: string) => void;
  resetKey: (id: EditorKeyId) => void;
  resetAll: () => void;
}

export const useEditorKeymapStore = create<EditorKeymapState>((set) => ({
  keys: loadBindings(),
  setKey: (id, key) =>
    set((state) => {
      const normalized = key ? normalizeEditorKey(key) : "";
      if (key && !normalized) return state;
      const keys = { ...state.keys, [id]: normalized };
      saveBindings(keys);
      return { keys };
    }),
  resetKey: (id) =>
    set((state) => {
      const keys = { ...state.keys, [id]: defaults[id] };
      saveBindings(keys);
      return { keys };
    }),
  resetAll: () => {
    const keys = { ...defaults };
    saveBindings(keys);
    set({ keys });
  },
}));
