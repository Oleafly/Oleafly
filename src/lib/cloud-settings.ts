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

// Settings that only make sense on the computer that chose them: the
// terminal shell (a Windows shell or path means nothing on a Mac), and whether
// task commands may reach the network, a security choice made per machine.
const LOCAL_ONLY_PATHS: readonly (readonly string[])[] = [
  ["appearance", "terminal", "shell"],
  ["appearance", "terminal", "shellPath"],
  ["research", "commandNetwork"],
];

/** `node` without the value at `path`, dropping parents it leaves empty. Never mutates. */
function withoutPath(node: Record<string, unknown>, path: readonly string[]): Record<string, unknown> {
  const [head, ...rest] = path;
  if (head === undefined || !Object.hasOwn(node, head)) return node;
  if (rest.length > 0) {
    const child = node[head];
    if (!isRecord(child)) return node;
    const next = withoutPath(child, rest);
    if (next === child) return node;
    if (Object.keys(next).length > 0) return { ...node, [head]: next };
  }
  return Object.fromEntries(Object.entries(node).filter(([key]) => key !== head));
}

export function withoutLocalOnlySettings(document: Record<string, unknown>): Record<string, unknown> {
  return LOCAL_ONLY_PATHS.reduce((current, path) => withoutPath(current, path), document);
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
