import { useSettingsStore } from "@/store/settings";

export function openZoteroSettings(): void {
  const settings = useSettingsStore.getState();
  settings.setSettingsInitialSection("integrations");
  settings.setSettingsScrollTarget("zotero");
  settings.setSettingsOpen(true);
}
