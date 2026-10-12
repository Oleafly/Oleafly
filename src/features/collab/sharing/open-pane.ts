import { useSettingsStore } from "@/store/settings";

export function openCollabPane(): void {
  const settings = useSettingsStore.getState();
  settings.setRailTab("collab");
  if (!settings.showTree) settings.toggleTree();
}
