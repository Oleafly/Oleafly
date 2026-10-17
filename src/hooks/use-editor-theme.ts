import { useSyncExternalStore } from "react";
import { editorColorKey, type EditorColorKey, type EditorThemeId } from "@/lib/editor-themes";
import { currentTheme, subscribeTheme, type Theme } from "@/lib/theme";
import { useSettingsStore } from "@/store/settings";

function useAppMode(): Theme {
  return useSyncExternalStore(subscribeTheme, currentTheme, currentTheme);
}

export function useEditorThemeId(): EditorThemeId {
  const mode = useAppMode();
  return useSettingsStore((state) => (mode === "dark" ? state.editorThemeDark : state.editorThemeLight));
}

export function useEditorColorKey(): EditorColorKey {
  const mode = useAppMode();
  const theme = useSettingsStore((state) => (mode === "dark" ? state.editorThemeDark : state.editorThemeLight));
  return editorColorKey(theme, mode);
}
