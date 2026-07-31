import { locale as tauriLocale } from "@tauri-apps/plugin-os";

export const SUPPORTED_LOCALES = ["en"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type LocalePreference = "system" | SupportedLocale;

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === "system" || (SUPPORTED_LOCALES as readonly string[]).includes(String(value));
}

export function normalizeLocale(value: string | null | undefined): SupportedLocale {
  const language = value?.trim().toLowerCase() ?? "";
  if (language === "en" || language.startsWith("en-")) return "en";
  return "en";
}

export async function resolveSystemLocale(): Promise<SupportedLocale> {
  try {
    return normalizeLocale(await tauriLocale());
  } catch {
    return "en";
  }
}
