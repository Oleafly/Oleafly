import { flattenCatalog, pluralSuffix } from "./catalog";
import type { MessageParams, Translator } from "./translator";

const PLACEHOLDER = /\{\{\s*([\w.-]+)\s*\}\}/gu;
const englishPlurals = new Intl.PluralRules("en");
const provided = new Map<string, unknown>();

export function provideTestCatalogs(catalogs: Readonly<Record<string, unknown>>): void {
  for (const [name, catalog] of Object.entries(catalogs)) provided.set(name, catalog);
}

export function testCatalog(name: string): unknown {
  if (!provided.has(name)) {
    throw new Error(`No English catalog was provided for "${name}". Register it in the Vitest setup file.`);
  }
  return provided.get(name);
}

export function catalogEntry(catalog: unknown, path: string): string | undefined {
  let node = catalog;
  for (const part of path.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

function pluralBase(key: string): string {
  const suffix = pluralSuffix(key);
  return suffix ? key.slice(0, -(suffix.length + 1)) : key;
}

export function missingCatalogKeys(catalog: unknown, keys: readonly string[]): string[] {
  return keys.filter(
    (key) =>
      catalogEntry(catalog, key) === undefined &&
      (catalogEntry(catalog, `${key}_one`) === undefined ||
        catalogEntry(catalog, `${key}_other`) === undefined),
  );
}

export function undeclaredCatalogKeys(catalog: unknown, keys: readonly string[]): string[] {
  const declared = new Set(keys);
  const bases = new Set([...flattenCatalog(catalog).keys()].map(pluralBase));
  return [...bases].filter((key) => !declared.has(key));
}

function interpolate(text: string, params?: MessageParams): string {
  if (!params) return text;
  return text.replace(PLACEHOLDER, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function catalogTranslator<K extends string>(catalog: unknown): Translator<K> {
  return (key, params) => {
    const count = params?.count;
    const plural =
      typeof count === "number"
        ? catalogEntry(catalog, `${key}_${englishPlurals.select(count)}`)
        : undefined;
    return interpolate(plural ?? catalogEntry(catalog, key) ?? key, params);
  };
}

export function testCatalogTranslator<K extends string>(name: string): Translator<K> {
  return (key, params) => catalogTranslator<K>(testCatalog(name))(key, params);
}

export interface CatalogProblems {
  missing: string[];
  undeclared: string[];
  duplicated: string[];
}

export function catalogProblems(name: string, keys: readonly string[]): CatalogProblems {
  const catalog = testCatalog(name);
  return {
    missing: missingCatalogKeys(catalog, keys),
    undeclared: undeclaredCatalogKeys(catalog, keys),
    duplicated: keys.filter((key, index) => keys.indexOf(key) !== index),
  };
}
