import { cssColorToHex, readClassVariables, readCssVariable, readElementVariables } from "@/lib/css-color";
import type { Theme } from "@/lib/theme";
import { accentTokenDefaults, themeTokenOverride } from "@/lib/theme-customization";
import { editorThemeSurface, type EditorThemeId } from "@/lib/editor-themes";
import type { EditorSurface } from "@/store/settings";

type ShownTheme = Readonly<{ theme: Theme; accentColor: string }>;

function modeCursorColor(mode: EditorSurface, shown: ShownTheme): string {
  if (mode === shown.theme) return readCssVariable("--cm-cursor") || readCssVariable("--primary");
  const probed = readClassVariables(mode, ["--cm-cursor", "--primary"]);
  return (
    probed["--cm-cursor"] ||
    themeTokenOverride(mode, "primary") ||
    accentTokenDefaults(mode, shown.accentColor)["--primary"] ||
    probed["--primary"] ||
    ""
  );
}

export function cursorThemeFor(
  surface: EditorSurface,
  themes: Readonly<Record<EditorSurface, EditorThemeId>>,
): EditorThemeId {
  const other: EditorSurface = surface === "light" ? "dark" : "light";
  for (const mode of [surface, other]) {
    if (editorThemeSurface(themes[mode], mode) === surface) return themes[mode];
  }
  return "system";
}

export function editorThemeCursorColor(
  surface: EditorSurface,
  editorTheme: EditorThemeId,
  shown: ShownTheme,
): string {
  const color =
    editorTheme === "system"
      ? modeCursorColor(surface, shown)
      : readElementVariables({ "data-editor-theme": editorTheme }, ["--cm-cursor"])["--cm-cursor"] ?? "";
  return cssColorToHex(color) ?? color;
}
