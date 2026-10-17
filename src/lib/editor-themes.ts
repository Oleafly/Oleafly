import {
  EDITOR_COLOR_IDS,
  editorColorVariable,
  themeColorValue,
  type EditorColorId,
} from "@oleafly/editor/color-roles";
import { cssColorToHex, paintedColorToHex } from "@/lib/css-color";
import type { Theme } from "@/lib/theme";

export const EDITOR_THEME_IDS = [
  "system",
  "linear",
  "github-dark",
  "dracula",
  "nord",
  "tokyo-night",
  "rose-pine",
  "catppuccin",
  "one-dark",
  "paper",
  "one-light",
] as const;

export type EditorThemeId = (typeof EDITOR_THEME_IDS)[number];

const LIGHT_EDITOR_THEMES: ReadonlySet<EditorThemeId> = new Set(["paper", "one-light"]);

export type EditorColorOverrides = Partial<Record<EditorColorId, string>>;

export type EditorColorKey = Exclude<EditorThemeId, "system"> | "system-light" | "system-dark";

export type EditorColorSettings = Partial<Record<EditorColorKey, EditorColorOverrides>>;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isEditorThemeId(value: unknown): value is EditorThemeId {
  return typeof value === "string" && (EDITOR_THEME_IDS as readonly string[]).includes(value);
}

export function editorThemeSurface(theme: EditorThemeId, mode: Theme): Theme {
  if (theme === "system") return mode;
  return LIGHT_EDITOR_THEMES.has(theme) ? "light" : "dark";
}

export function editorColorKey(theme: EditorThemeId, mode: Theme): EditorColorKey {
  return theme === "system" ? `system-${mode}` : theme;
}

function isEditorColorKey(value: string): value is EditorColorKey {
  return value === "system-light" || value === "system-dark" || (isEditorThemeId(value) && value !== "system");
}

function isEditorColorId(value: string): value is EditorColorId {
  return (EDITOR_COLOR_IDS as readonly string[]).includes(value);
}

export function normalizeEditorColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = cssColorToHex(value.trim());
  return hex && HEX_COLOR.test(hex) ? hex : null;
}

function validateOverrides(value: unknown): EditorColorOverrides {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const overrides: EditorColorOverrides = {};
  for (const [id, color] of Object.entries(value)) {
    const normalized = normalizeEditorColor(color);
    if (isEditorColorId(id) && normalized) overrides[id] = normalized;
  }
  return overrides;
}

export function validateEditorColors(value: unknown): EditorColorSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const settings: EditorColorSettings = {};
  for (const [key, overrides] of Object.entries(value)) {
    if (!isEditorColorKey(key)) continue;
    const valid = validateOverrides(overrides);
    if (Object.keys(valid).length > 0) settings[key] = valid;
  }
  return settings;
}

export function applyEditorColors(
  overrides: EditorColorOverrides,
  root: HTMLElement = document.documentElement,
): void {
  for (const id of EDITOR_COLOR_IDS) {
    const color = overrides[id];
    if (color) root.style.setProperty(editorColorVariable(id), color);
    else root.style.removeProperty(editorColorVariable(id));
  }
}

export function editorColorPreviewStyle(overrides: EditorColorOverrides): Record<string, string> {
  return Object.fromEntries(
    EDITOR_COLOR_IDS.map((id) => [editorColorVariable(id), overrides[id] ?? "initial"]),
  );
}

export function readEditorThemeColors(
  theme: EditorThemeId,
  mode: Theme,
  modeStyle: Readonly<Record<string, string>> = {},
): Record<EditorColorId, string> {
  const colors = Object.fromEntries(EDITOR_COLOR_IDS.map((id) => [id, ""])) as Record<
    EditorColorId,
    string
  >;
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") return colors;
  const scope = document.createElement("div");
  scope.className = mode;
  for (const [name, value] of Object.entries(modeStyle)) scope.style.setProperty(name, value);
  const probe = document.createElement("div");
  probe.dataset.editorTheme = theme;
  for (const id of EDITOR_COLOR_IDS) probe.style.setProperty(editorColorVariable(id), "initial");
  scope.append(probe);
  scope.hidden = true;
  document.body.append(scope);
  for (const id of EDITOR_COLOR_IDS) {
    probe.style.color = themeColorValue(id);
    colors[id] = paintedColorToHex(getComputedStyle(probe).color) ?? "";
  }
  scope.remove();
  return colors;
}

export type EditorThemeExport = Readonly<{
  themes: Readonly<Record<Theme, EditorThemeId>>;
  colors: EditorColorSettings;
}>;

export function parseEditorThemeExport(value: unknown): EditorThemeExport | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const themes = record.themes as Record<string, unknown> | undefined;
  return {
    themes: {
      light: isEditorThemeId(themes?.light) ? themes.light : "system",
      dark: isEditorThemeId(themes?.dark) ? themes.dark : "system",
    },
    colors: validateEditorColors(record.colors),
  };
}
