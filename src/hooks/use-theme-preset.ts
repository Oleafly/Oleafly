import { useAppTheme, type Theme } from "@/lib/theme";
import { effectiveAccentColor } from "@/lib/theme-customization";
import { findThemePreset, type ThemePreset } from "@/lib/theme-presets";
import { useSettingsStore } from "@/store/settings";

export function useThemePreset(mode: Theme): ThemePreset {
  const id = useSettingsStore((state) => (mode === "dark" ? state.appThemeDark : state.appThemeLight));
  return findThemePreset(mode, id);
}

export function useEffectiveAccentColor(): string {
  const mode = useAppTheme();
  const accent = useSettingsStore((state) => state.accentColor);
  const preset = useThemePreset(mode);
  return effectiveAccentColor(mode, accent, preset);
}
