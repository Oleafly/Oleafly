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

// Settings each computer keeps for itself. The default LaTeX engine is one this
// computer has: latexmk needs a TeX installation another computer may lack.
const LOCAL_ONLY: ReadonlyArray<readonly [section: string, key: string]> = [
  ["experimentation", "webBrowser"],
  ["engine", "defaultLatexEngine"],
];

export function withoutLocalOnlySettings(document: Record<string, unknown>): Record<string, unknown> {
  let copy: Record<string, unknown> | null = null;
  for (const [section, key] of LOCAL_ONLY) {
    const group = (copy ?? document)[section];
    if (!isRecord(group) || !(key in group)) continue;
    copy ??= { ...document };
    const kept = Object.fromEntries(Object.entries(group).filter(([name]) => name !== key));
    if (Object.keys(kept).length > 0) copy[section] = kept;
    else delete copy[section];
  }
  return copy ?? document;
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
