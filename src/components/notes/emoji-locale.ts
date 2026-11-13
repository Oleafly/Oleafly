const RENAMED: Readonly<Record<string, string>> = {
  "pt-BR": "pt",
  "zh-Hans": "zh",
  "zh-Hant": "zh-hant",
};

const SHARED = [
  "da",
  "de",
  "en",
  "es",
  "fi",
  "fr",
  "it",
  "ja",
  "ko",
  "nb",
  "nl",
  "pl",
  "ru",
  "sv",
  "uk",
  "vi",
] as const;

export const EMOJIBASE_PATH = "emojibase";

export const EMOJIBASE_LOCALES: readonly string[] = [...SHARED, ...Object.values(RENAMED)].sort((left, right) =>
  left < right ? -1 : Number(left > right),
);

export function emojibaseLocale(locale: string): string {
  if (Object.hasOwn(RENAMED, locale)) return RENAMED[locale];
  return (SHARED as readonly string[]).includes(locale) ? locale : "en";
}
