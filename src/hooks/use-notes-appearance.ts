import { useCallback } from "react";
import type { EditorThemeId } from "@/lib/editor-themes";
import {
  NOTES_APPEARANCE_KEYS,
  type NotesAppearance,
} from "@/lib/notes-appearance";
import {
  NOTES_CODE_PALETTE,
  notesAppearanceAttributes,
  notesAppearanceVariables,
  resolveNotesCodeTheme,
} from "@/lib/notes-appearance-style";
import { currentTheme, subscribeTheme, type Theme } from "@/lib/theme";
import { useSettingsStore } from "@/store/settings";

export interface NotesAppearanceStyle {
  variables: Readonly<Record<string, string>>;
  attributes: Readonly<Record<string, string | null>>;
}

const EMPTY_STYLE: NotesAppearanceStyle = { variables: {}, attributes: {} };
const palettes = new Map<EditorThemeId, Readonly<Record<string, string>>>();

export function readCodePalette(theme: EditorThemeId): Readonly<Record<string, string>> {
  const cached = palettes.get(theme);
  if (cached) return cached;
  const probe = document.createElement("div");
  probe.dataset.editorTheme = theme;
  probe.hidden = true;
  document.body.append(probe);
  const computed = getComputedStyle(probe);
  const palette: Record<string, string> = {};
  for (const [source, target] of NOTES_CODE_PALETTE) {
    const value = computed.getPropertyValue(source).trim();
    if (value) palette[target] = value;
  }
  probe.remove();
  if (Object.keys(palette).length > 0) palettes.set(theme, palette);
  return palette;
}

export function resetCodePalettesForTest(): void {
  palettes.clear();
}

export function notesAppearanceStyle(
  appearance: NotesAppearance,
  mode: Theme,
  editorThemes: Readonly<Record<Theme, EditorThemeId>>,
): NotesAppearanceStyle {
  const variables = notesAppearanceVariables(appearance);
  const attributes: Record<string, string | null> = notesAppearanceAttributes(appearance);
  const codeTheme = resolveNotesCodeTheme(appearance.notesCodeTheme, mode, editorThemes);
  attributes["data-notes-code-theme"] = null;
  if (codeTheme !== "system") {
    const palette = readCodePalette(codeTheme);
    if (Object.keys(palette).length > 0) {
      Object.assign(variables, palette);
      attributes["data-notes-code-theme"] = codeTheme;
    }
  }
  return { variables, attributes };
}

export function writeNotesAppearance(
  element: HTMLElement,
  next: NotesAppearanceStyle,
  previous: NotesAppearanceStyle = EMPTY_STYLE,
): NotesAppearanceStyle {
  for (const name of Object.keys(previous.variables)) {
    if (!(name in next.variables)) element.style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(next.variables)) {
    if (previous.variables[name] !== value) element.style.setProperty(name, value);
  }
  for (const name of Object.keys(previous.attributes)) {
    if (!(name in next.attributes)) element.removeAttribute(name);
  }
  for (const [name, value] of Object.entries(next.attributes)) {
    if (previous.attributes[name] === value) continue;
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  }
  return next;
}

function currentStyle(): NotesAppearanceStyle {
  const state = useSettingsStore.getState();
  return notesAppearanceStyle(state, currentTheme(), { light: state.editorThemeLight, dark: state.editorThemeDark });
}

const STYLE_KEYS = [...NOTES_APPEARANCE_KEYS, "editorThemeLight", "editorThemeDark"] as const;

export function attachNotesAppearance(element: HTMLElement): () => void {
  let applied = writeNotesAppearance(element, currentStyle());
  const apply = () => {
    applied = writeNotesAppearance(element, currentStyle(), applied);
  };
  const stopSettings = useSettingsStore.subscribe((state, previous) => {
    if (STYLE_KEYS.some((key) => state[key] !== previous[key])) apply();
  });
  const stopTheme = subscribeTheme(apply);
  return () => {
    stopSettings();
    stopTheme();
    writeNotesAppearance(element, EMPTY_STYLE, applied);
  };
}

export function useNotesAppearanceRef<T extends HTMLElement>(): (element: T | null) => (() => void) | undefined {
  return useCallback((element: T | null) => (element ? attachNotesAppearance(element) : undefined), []);
}
