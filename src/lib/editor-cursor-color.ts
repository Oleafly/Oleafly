import { cssColorToHex, readClassVariables, readCssVariable, readElementVariables } from "@/lib/css-color";
import type { Theme } from "@/lib/theme";
import { accentTokenDefaults, themeTokenOverride } from "@/lib/theme-customization";
import type { EditorSurface, EditorThemeId } from "@/store/settings";

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

export function editorThemeCursorColor(
  surface: EditorSurface,
  editorTheme: EditorThemeId,
  shown: ShownTheme,
): string {
  const color =
    surface === "dark" && editorTheme !== "system"
      ? readElementVariables({ "data-editor-theme": editorTheme }, ["--cm-cursor"])["--cm-cursor"] ?? ""
      : modeCursorColor(surface, shown);
  return cssColorToHex(color) ?? color;
}
