import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractPlaceholders,
  flattenCatalog,
  pluralBase,
  pluralCategories,
  SUPPORTED_LOCALES,
  validateCatalog,
} from "@oleafly/i18n-contract";

const HERE = `${__dirname}/`;
const DESKTOP = `${resolve(__dirname, "../../../src/i18n")}/`;

function read(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

const english = flattenCatalog(read(`${HERE}en.json`));
const glossary = read(`${DESKTOP}glossary.json`) as { doNotTranslate: string[] };
const others = SUPPORTED_LOCALES.filter((locale) => locale !== "en");
const englishPlain = [...english.keys()].filter((key) => pluralBase(key) === null);
const englishPlurals = [...new Set([...english.keys()].map(pluralBase).filter((base) => base !== null))];

function catalog(locale: string): Map<string, string> {
  return flattenCatalog(read(`${HERE}${locale}.json`));
}

function englishFor(key: string): string | undefined {
  const base = pluralBase(key);
  return base === null ? english.get(key) : english.get(`${base}_other`);
}

describe("web translations", () => {
  it("has one catalog per app locale and nothing else", () => {
    const files = readdirSync(HERE)
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length))
      .sort();
    expect(files).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it.each(others)("%s has exactly the English keys, with its own plural forms", (locale) => {
    const keys = [...catalog(locale).keys()];
    expect(keys.filter((key) => pluralBase(key) === null)).toEqual(englishPlain);
    const forms = pluralCategories(locale);
    for (const base of englishPlurals) {
      expect(keys.filter((key) => pluralBase(key) === base).sort(), base).toEqual(forms.map((form) => `${base}_${form}`).sort());
    }
  });

  it.each(others)("%s keeps every interpolation token of the English", (locale) => {
    for (const [key, value] of catalog(locale)) {
      expect(extractPlaceholders(value), key).toEqual(extractPlaceholders(englishFor(key) ?? ""));
    }
  });

  it.each(others)("%s passes the desktop catalog rules", (locale) => {
    const issues = validateCatalog("web", locale, english, catalog(locale), { doNotTranslate: glossary.doNotTranslate });
    expect(issues.map((issue) => `${issue.key}: ${issue.message}`)).toEqual([]);
  });

  it.each(others)("%s keeps interface copy plain: no exclamation marks or trailing ellipses", (locale) => {
    const offenders = [...catalog(locale)].filter(([, value]) => /[!！]/u.test(value) || /(?:\.\.\.|…)$/u.test(value));
    expect(offenders).toEqual([]);
  });

  it.each(others)("%s has the editor and PDF viewer strings the browser app reuses", (locale) => {
    for (const namespace of ["editor", "preview"]) {
      const desktop = read(`${DESKTOP}locales/${locale}/${namespace}.json`) as { package?: unknown };
      expect(typeof desktop.package, `${locale}/${namespace}.json`).toBe("object");
    }
  });
});
