import { useCallback } from "react";
import { type AppearanceStyle, attachAppearanceStyle } from "@/lib/appearance-style";
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
): AppearanceStyle {
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

function currentStyle(): AppearanceStyle {
  const state = useSettingsStore.getState();
  return notesAppearanceStyle(state, currentTheme(), { light: state.editorThemeLight, dark: state.editorThemeDark });
}

const STYLE_KEYS = [...NOTES_APPEARANCE_KEYS, "editorThemeLight", "editorThemeDark"] as const;

export function attachNotesAppearance(element: HTMLElement): () => void {
  return attachAppearanceStyle(element, STYLE_KEYS, currentStyle, [subscribeTheme]);
}

export function useNotesAppearanceRef<T extends HTMLElement>(): (element: T | null) => (() => void) | undefined {
  return useCallback((element: T | null) => (element ? attachNotesAppearance(element) : undefined), []);
}
