import { invoke } from "@tauri-apps/api/core";

export interface PickedSettingsFile {
  name: string;
  text: string;
}

export function pickSettingsFile(title: string, filter: string): Promise<PickedSettingsFile | null> {
  return invoke<PickedSettingsFile | null>("pick_settings_file", { title, filter });
}
