import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { useTheme } from "@/lib/theme";
import { useEditorKeymapStore } from "@/store/editor-keymap";
import { useSettingsStore } from "@/store/settings";
import {
  changedCountsBySection,
  changedSettings,
  pickSettingValues,
  resetSetting,
  settingById,
  type SettingDefinition,
  type SettingSectionId,
  type SettingsSnapshot,
} from "@/store/settings-schema";
import { useShortcutStore } from "@/store/shortcuts";

export interface ChangedSettingsState {
  snapshot: SettingsSnapshot;
  /** Changed settings in schema order. */
  changed: readonly SettingDefinition[];
  counts: Partial<Record<SettingSectionId, number>>;
  total: number;
  isChanged(id: string): boolean;
  reset(id: string): void;
}

/** Which settings differ from their defaults, recomputed only when a setting changes. */
export function useChangedSettingsState(): ChangedSettingsState {
  const settings = useSettingsStore(useShallow(pickSettingValues));
  const shortcuts = useShortcutStore((state) => state.bindings);
  const editorKeys = useEditorKeymapStore((state) => state.keys);
  const { preference, setPreference } = useTheme();

  return useMemo(() => {
    const snapshot: SettingsSnapshot = {
      settings,
      shortcuts,
      editorKeys,
      themePreference: preference,
    };
    const changed = changedSettings(snapshot);
    const changedIds = new Set<string>(changed.map(({ id }) => id));
    return {
      snapshot,
      changed,
      counts: changedCountsBySection(snapshot),
      total: changed.length,
      isChanged: (id) => changedIds.has(id),
      reset: (id) => {
        const definition = settingById(id);
        if (definition) resetSetting(definition, snapshot, { setThemePreference: setPreference });
      },
    };
  }, [settings, shortcuts, editorKeys, preference, setPreference]);
}

// Null outside the Settings dialog, so a section rendered on its own keeps
// its plain rows.
export const ChangedSettingsContext = createContext<ChangedSettingsState | null>(null);

export function useChangedSettings(): ChangedSettingsState | null {
  return useContext(ChangedSettingsContext);
}

export function ChangedSettingsProvider({ children }: Readonly<{ children: ReactNode }>) {
  const state = useChangedSettingsState();
  return <ChangedSettingsContext.Provider value={state}>{children}</ChangedSettingsContext.Provider>;
}
