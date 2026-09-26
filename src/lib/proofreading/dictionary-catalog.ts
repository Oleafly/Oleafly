import type { DictionaryInfo } from "@oleafly/backend-port";
import { listDictionaries } from "@/lib/tauri";

export const BUNDLED_DICTIONARY_LOCALES: ReadonlySet<string> = new Set([
  "de_DE",
  "en_AU",
  "en_GB",
  "en_US",
  "fr_FR",
]);

export const DEFAULT_DICTIONARY_LOCALE = "en_US";

const DICTIONARY_LOCALE_SHAPE = /^[a-z]{2,3}(?:_[A-Za-z]{2,4})?$/u;

export interface DictionaryLanguageGroup {
  language: string;
  entries: DictionaryInfo[];
}

export function normalizeDictionaryLocale(value: string): string {
  return value.trim().replace("-", "_");
}

export function isDictionaryLocaleId(value: string): boolean {
  return DICTIONARY_LOCALE_SHAPE.test(normalizeDictionaryLocale(value));
}

export function isBundledDictionary(locale: string): boolean {
  return BUNDLED_DICTIONARY_LOCALES.has(normalizeDictionaryLocale(locale));
}

export function isEnglishDictionaryLocale(locale: string): boolean {
  return (
    normalizeDictionaryLocale(locale).split("_")[0].toLowerCase() === "en"
  );
}

function qualifierOf(locale: string): string | null {
  const [, qualifier] = normalizeDictionaryLocale(locale).split("_");
  return qualifier ?? null;
}

function localizedLanguage(locale: string, uiLocale: string): string | null {
  const language = normalizeDictionaryLocale(locale).split("_")[0];
  try {
    return (
      new Intl.DisplayNames([uiLocale], {
        type: "language",
        fallback: "none",
      }).of(language) ?? null
    );
  } catch {
    return null;
  }
}

function localizedQualifier(locale: string, uiLocale: string): string | null {
  const qualifier = qualifierOf(locale);
  if (!qualifier) return null;
  const type = /^[A-Z]{2}$/u.test(qualifier) ? "region" : "script";
  try {
    return (
      new Intl.DisplayNames([uiLocale], { type, fallback: "none" }).of(
        qualifier,
      ) ?? null
    );
  } catch {
    return null;
  }
}

export function dictionaryLanguageName(
  entry: Pick<DictionaryInfo, "id" | "language">,
  uiLocale: string,
): string {
  return localizedLanguage(entry.id, uiLocale) ?? entry.language;
}

export function dictionaryLabel(
  entry: Pick<DictionaryInfo, "id" | "language" | "region">,
  uiLocale: string,
): string {
  const language = dictionaryLanguageName(entry, uiLocale);
  const qualifier = localizedQualifier(entry.id, uiLocale) ?? entry.region;
  return qualifier ? `${language} (${qualifier})` : language;
}

export function groupDictionariesByLanguage(
  entries: readonly DictionaryInfo[],
  uiLocale: string,
): DictionaryLanguageGroup[] {
  const groups = new Map<string, DictionaryInfo[]>();
  for (const entry of entries) {
    const language = dictionaryLanguageName(entry, uiLocale);
    const bucket = groups.get(language);
    if (bucket) bucket.push(entry);
    else groups.set(language, [entry]);
  }
  const collator = new Intl.Collator(uiLocale);
  return [...groups.entries()]
    .map(([language, bucket]) => ({
      language,
      entries: [...bucket].sort((left, right) =>
        collator.compare(
          dictionaryLabel(left, uiLocale),
          dictionaryLabel(right, uiLocale),
        ),
      ),
    }))
    .sort((left, right) => collator.compare(left.language, right.language));
}

export function matchesDictionaryQuery(
  entry: Pick<DictionaryInfo, "id" | "language" | "region">,
  uiLocale: string,
  query: string,
): boolean {
  const needle = query.trim().toLocaleLowerCase(uiLocale);
  if (!needle) return true;
  const haystack = [
    entry.id,
    entry.language,
    entry.region ?? "",
    dictionaryLabel(entry, uiLocale),
  ]
    .join(" ")
    .toLocaleLowerCase(uiLocale);
  return haystack.includes(needle);
}

let catalogPromise: Promise<DictionaryInfo[]> | null = null;

export function loadDictionaryCatalog(): Promise<DictionaryInfo[]> {
  catalogPromise ??= (async () => {
    const entries = await listDictionaries();
    return Array.isArray(entries) ? entries : [];
  })().catch((error) => {
    catalogPromise = null;
    throw error;
  });
  return catalogPromise;
}

const catalogListeners = new Set<(entries: DictionaryInfo[]) => void>();

export function subscribeDictionaryCatalog(
  listener: (entries: DictionaryInfo[]) => void,
): () => void {
  catalogListeners.add(listener);
  return () => {
    catalogListeners.delete(listener);
  };
}

export async function refreshDictionaryCatalog(): Promise<DictionaryInfo[]> {
  catalogPromise = null;
  const entries = await loadDictionaryCatalog();
  for (const listener of catalogListeners) listener(entries);
  return entries;
}

export function effectiveDictionaryLocale(input: {
  project?: string | null;
  global?: string | null;
}): string {
  for (const candidate of [input.project, input.global]) {
    if (!candidate) continue;
    const normalized = normalizeDictionaryLocale(candidate);
    if (isDictionaryLocaleId(normalized)) return normalized;
  }
  return DEFAULT_DICTIONARY_LOCALE;
}
