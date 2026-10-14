import {
  applySettingsPlan,
  buildSettingsDocument,
  captureSettingsSnapshot,
  readSettingsFile,
} from "@/lib/settings-file/transfer";
import { getStoredPreference, requestThemePreference, type ThemePreference } from "@/lib/theme";

const THEME = {
  get preference() {
    return getStoredPreference();
  },
  setPreference: (preference: ThemePreference) => requestThemePreference(preference),
};

export async function gatherCloudSettings(): Promise<Record<string, unknown>> {
  return buildSettingsDocument(await captureSettingsSnapshot(getStoredPreference()));
}

export async function applyCloudSettings(document: Record<string, unknown>): Promise<void> {
  const snapshot = await captureSettingsSnapshot(getStoredPreference());
  const read = readSettingsFile(JSON.stringify(document), snapshot);
  if (!read.ok) {
    throw new Error("cloud settings document is not valid");
  }
  await applySettingsPlan(read.plan, THEME);
}
