import { useCallback, useState } from "react";
import { useSettingsStore } from "@/store/settings";

export function useSettingsTab<T extends string>(
  section: string,
  fallback: T | (() => T),
  isTab: (value: string) => value is T,
): [T, (tab: string) => void] {
  const [tab, setTab] = useState<T>(() => {
    const { settingsOpen, settingsInitialSection, settingsLastTabs } = useSettingsStore.getState();
    const resumed = settingsOpen && settingsInitialSection === null ? settingsLastTabs[section] : undefined;
    if (resumed !== undefined && isTab(resumed)) return resumed;
    return typeof fallback === "function" ? fallback() : fallback;
  });
  const choose = useCallback(
    (next: string) => {
      if (!isTab(next)) return;
      setTab(next);
      useSettingsStore.getState().rememberSettingsTab(section, next);
    },
    [section, isTab],
  );
  return [tab, choose];
}
