type SettingsTourSection =
  | "general"
  | "appearance"
  | "dictionary"
  | "data"
  | "engine"
  | "downloads"
  | "integrations"
  | "shortcuts"
  | "help";

export interface SettingsTourDestination {
  section: SettingsTourSection;
  scrollTarget?: string;
}

const DESTINATIONS: Partial<Record<string, SettingsTourDestination>> = {
  "settings-general": { section: "general" },
  "settings-appearance": { section: "appearance" },
  "settings-dictionary": { section: "dictionary" },
  "settings-data": { section: "data" },
  "settings-compiler": { section: "engine" },
  "settings-downloads": { section: "downloads" },
  "settings-integrations": { section: "integrations" },
  "settings-shortcuts": { section: "shortcuts" },
  "settings-help": { section: "help" },
};

export function settingsTourDestination(
  stepId: string,
): SettingsTourDestination | null {
  return DESTINATIONS[stepId] ?? null;
}
