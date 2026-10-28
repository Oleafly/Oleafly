import { canonicalizeLocale, DEFAULT_LOCALE, resolveLocale, type SupportedLocale } from "@oleafly/i18n-contract";

export function resolveWebLocale(languages: readonly (string | null | undefined)[]): SupportedLocale {
  for (const tag of languages) {
    const canonical = canonicalizeLocale(tag);
    if (!canonical) continue;
    const locale = resolveLocale(canonical);
    if (locale !== DEFAULT_LOCALE || canonical.split("-", 1)[0] === DEFAULT_LOCALE) return locale;
  }
  return DEFAULT_LOCALE;
}

export function browserLanguages(source: Pick<Navigator, "languages" | "language"> | undefined = globalThis.navigator): string[] {
  if (!source) return [];
  if (Array.isArray(source.languages) && source.languages.length > 0) return [...source.languages];
  return source.language ? [source.language] : [];
}
