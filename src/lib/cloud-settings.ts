import {
  applySettingsPlan,
  buildSettingsDocument,
  captureSettingsSnapshot,
  readSettingsFile,
  validSettingsSubset,
  type SettingsFileRead,
} from "@/lib/settings-file/transfer";
import type { SettingsSnapshot } from "@/lib/settings-file/schema";
import { isRecord } from "@/lib/settings-file/values";
import { getStoredPreference, requestThemePreference, type ThemePreference } from "@/lib/theme";

const THEME = {
  get preference() {
    return getStoredPreference();
  },
  setPreference: (preference: ThemePreference) => requestThemePreference(preference),
};

const LOCAL_ONLY_EXPERIMENTS: ReadonlySet<string> = new Set(["webBrowser"]);

export function withoutLocalOnlySettings(document: Record<string, unknown>): Record<string, unknown> {
  const experimentation = document.experimentation;
  if (!isRecord(experimentation) || !Object.keys(experimentation).some((key) => LOCAL_ONLY_EXPERIMENTS.has(key))) {
    return document;
  }
  const kept = Object.fromEntries(
    Object.entries(experimentation).filter(([key]) => !LOCAL_ONLY_EXPERIMENTS.has(key)),
  );
  const copy = Object.fromEntries(Object.entries(document).filter(([key]) => key !== "experimentation"));
  return Object.keys(kept).length > 0 ? { ...copy, experimentation: kept } : copy;
}

export async function gatherCloudSettings(): Promise<Record<string, unknown>> {
  return withoutLocalOnlySettings(buildSettingsDocument(await captureSettingsSnapshot(getStoredPreference())));
}

export function readCloudSettings(values: Record<string, unknown>, snapshot: SettingsSnapshot): SettingsFileRead {
  const subset = validSettingsSubset(withoutLocalOnlySettings(values));
  return readSettingsFile(JSON.stringify(subset), snapshot);
}

export async function applyCloudSettings(values: Record<string, unknown>): Promise<Record<string, unknown>> {
  const read = readCloudSettings(values, await captureSettingsSnapshot(getStoredPreference()));
  if (read.ok && read.changed.length > 0) await applySettingsPlan(read.plan, THEME);
  return gatherCloudSettings();
}
