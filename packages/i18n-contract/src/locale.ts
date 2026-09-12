export const SUPPORTED_LOCALES = ["en", "zh-Hans"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type LocalePreference = "system" | SupportedLocale;
export const DEFAULT_LOCALE: SupportedLocale = "en";

export interface LocaleInfo {
  nativeName: string;
  dir: "ltr" | "rtl";
}

export const LOCALE_INFO: Record<SupportedLocale, LocaleInfo> = {
  en: { nativeName: "English", dir: "ltr" },
  "zh-Hans": { nativeName: "简体中文", dir: "ltr" },
};

const FALLBACKS: Record<string, readonly SupportedLocale[]> = {
  "zh-Hant": ["zh-Hans"],
};

const TRADITIONAL_MARKERS = new Set(["hant", "tw", "hk", "mo"]);

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === "system" || isSupportedLocale(value);
}

export function canonicalizeLocale(tag: string | null | undefined): string | null {
  const trimmed = tag?.trim().toLowerCase() ?? "";
  if (!trimmed) return null;
  const withoutEncoding = trimmed.split(/[.@]/, 1)[0] ?? "";
  const parts = withoutEncoding.split(/[-_]/).filter(Boolean);
  const language = parts[0];
  if (!language) return null;
  if (language === "zh") {
    const traditional = parts.slice(1).some((part) => TRADITIONAL_MARKERS.has(part));
    return traditional ? "zh-Hant" : "zh-Hans";
  }
  const region = parts.slice(1).find((part) => /^[a-z]{2}$/.test(part));
  return region ? `${language}-${region.toUpperCase()}` : language;
}

export function resolveLocale(tag: string | null | undefined): SupportedLocale {
  const canonical = canonicalizeLocale(tag);
  if (!canonical) return DEFAULT_LOCALE;
  const candidates = [canonical, canonical.split("-", 1)[0] ?? canonical];
  for (const candidate of candidates) {
    if (isSupportedLocale(candidate)) return candidate;
    const fallback = FALLBACKS[candidate]?.find(isSupportedLocale);
    if (fallback) return fallback;
  }
  return DEFAULT_LOCALE;
}

export function resolvePreference(
  preference: LocalePreference,
  systemTag: string | null | undefined,
): SupportedLocale {
  return preference === "system" ? resolveLocale(systemTag) : preference;
}

export type TranslateParams = Record<string, string | number | boolean | null | undefined>;
export type Translator = (key: string, params?: TranslateParams) => string;
