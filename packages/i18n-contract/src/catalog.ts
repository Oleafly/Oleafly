export type FlatCatalog = Map<string, string>;

export function flattenCatalog(value: unknown, prefix = "", out: FlatCatalog = new Map()): FlatCatalog {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flattenCatalog(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  if (typeof value === "string") out.set(prefix, value);
  return out;
}

const PLACEHOLDER = /\{\{\s*([\w.-]+)\s*\}\}/g;
const TAG = /<\/?([A-Za-z][\w-]*)[^<>]*>/g;

export function extractPlaceholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1] ?? "").sort();
}

export function extractTags(text: string): string[] {
  return [...text.matchAll(TAG)].map((m) => m[1] ?? "").sort();
}

export const PLURAL_SUFFIXES = ["zero", "one", "two", "few", "many", "other"] as const;

export function pluralSuffix(key: string): string | null {
  const index = key.lastIndexOf("_");
  if (index < 0) return null;
  const suffix = key.slice(index + 1);
  return (PLURAL_SUFFIXES as readonly string[]).includes(suffix) ? suffix : null;
}

export function pluralCategories(locale: string): string[] {
  return [...new Intl.PluralRules(locale).resolvedOptions().pluralCategories].sort();
}

export interface CatalogIssue {
  level: "error" | "warning";
  locale: string;
  namespace: string;
  key: string;
  message: string;
}

export interface ValidateOptions {
  doNotTranslate?: readonly string[];
}

const EM_DASH = /[—–]/;
const HALF_WIDTH_NEXT_TO_CJK = /(\p{Script=Han}[,;:?!])|([,;:?!]\p{Script=Han})/u;
const CORNER_BRACKETS = /[「」『』]/;
const FULL_WIDTH_PUNCTUATION = /[，。：？！（）；、]/;
const SPACE_NEXT_TO_FULL_WIDTH = /(\s[，。：？！；、）])|([，。：？！；、（]\s)/;

function pushIssue(
  issues: CatalogIssue[],
  level: CatalogIssue["level"],
  locale: string,
  namespace: string,
  key: string,
  message: string,
): void {
  issues.push({ level, locale, namespace, key, message });
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function checkCommon(issues: CatalogIssue[], locale: string, namespace: string, key: string, value: string): void {
  if (value.trim() === "") pushIssue(issues, "error", locale, namespace, key, "value is empty");
  if (value !== value.trim()) pushIssue(issues, "error", locale, namespace, key, "value has leading or trailing whitespace");
  if (EM_DASH.test(value)) pushIssue(issues, "error", locale, namespace, key, "value contains an em dash or en dash");
  const suffix = pluralSuffix(key);
  if (suffix && !pluralCategories(locale).includes(suffix)) {
    pushIssue(issues, "error", locale, namespace, key, `plural category "${suffix}" does not exist for ${locale}`);
  }
}

function checkChinese(issues: CatalogIssue[], locale: string, namespace: string, key: string, value: string): void {
  if (HALF_WIDTH_NEXT_TO_CJK.test(value)) {
    pushIssue(issues, "error", locale, namespace, key, "half-width punctuation between Chinese characters");
  }
  if (CORNER_BRACKETS.test(value)) {
    pushIssue(issues, "error", locale, namespace, key, "corner brackets are Traditional Chinese convention, use “”");
  }
  if (FULL_WIDTH_PUNCTUATION.test(value) && SPACE_NEXT_TO_FULL_WIDTH.test(value)) {
    pushIssue(issues, "warning", locale, namespace, key, "space next to full-width punctuation");
  }
}

export function validateSourceCatalog(
  namespace: string,
  locale: string,
  source: FlatCatalog,
  _options: ValidateOptions,
): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  for (const [key, value] of source) checkCommon(issues, locale, namespace, key, value);
  return issues;
}

export function validateCatalog(
  namespace: string,
  locale: string,
  source: FlatCatalog,
  target: FlatCatalog,
  options: ValidateOptions,
): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const categories = pluralCategories(locale);
  const chinese = locale.startsWith("zh");

  for (const [key, sourceValue] of source) {
    const suffix = pluralSuffix(key);
    const expected = suffix ? categories.includes(suffix) : true;
    const value = target.get(key);
    if (value === undefined) {
      if (expected) pushIssue(issues, "error", locale, namespace, key, "key is missing");
      continue;
    }
    if (!expected) {
      pushIssue(issues, "error", locale, namespace, key, `plural category "${suffix}" does not exist for ${locale}`);
      continue;
    }
    checkCommon(issues, locale, namespace, key, value);
    if (value.trim() === "") continue;
    if (!sameList(extractPlaceholders(sourceValue), extractPlaceholders(value))) {
      pushIssue(issues, "error", locale, namespace, key, "placeholders differ from the source");
    }
    if (!sameList(extractTags(sourceValue), extractTags(value))) {
      pushIssue(issues, "error", locale, namespace, key, "tags differ from the source");
    }
    for (const term of options.doNotTranslate ?? []) {
      if (sourceValue.includes(term) && !value.includes(term)) {
        pushIssue(issues, "error", locale, namespace, key, `term "${term}" must stay verbatim`);
      }
    }
    if (chinese) checkChinese(issues, locale, namespace, key, value);
  }

  for (const key of target.keys()) {
    if (!source.has(key)) pushIssue(issues, "error", locale, namespace, key, "key is not in the source catalog");
  }
  return issues;
}
