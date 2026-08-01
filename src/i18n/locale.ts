import { locale as tauriLocale } from "@tauri-apps/plugin-os";

export const SUPPORTED_LOCALES = ["en", "es", "fr", "zh"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type LocalePreference = "system" | SupportedLocale;

// Shown in the language picker in the language itself, so every reader can
// find their own entry; deliberately not translated through the catalogs.
export const LOCALE_NATIVE_NAMES: Record<SupportedLocale, string> = {
  en: "English",
  es: "Español",
  fr: "Français",
  zh: "中文",
};

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return (
    typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === "system" || isSupportedLocale(value);
}

export function normalizeLocale(value: string | null | undefined): SupportedLocale {
  const tag = value?.trim().toLowerCase() ?? "";
  if (!tag) return "en";
  // BCP-47 region/script variants map to their primary language subtag
  // (es-MX -> es, fr-CA -> fr, zh-Hans-CN -> zh).
  const language = tag.split(/[-_]/, 1)[0];
  return isSupportedLocale(language) ? language : "en";
}

export async function resolveSystemLocale(): Promise<SupportedLocale> {
  try {
    return normalizeLocale(await tauriLocale());
  } catch {
    return "en";
  }
}
