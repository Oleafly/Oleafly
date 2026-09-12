import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { flattenCatalog, type FlatCatalog } from "../../../packages/i18n-contract/src/catalog.ts";

export const ROOT = new URL("../../../", import.meta.url).pathname;
export const LOCALES_DIR = join(ROOT, "src/i18n/locales");
export const CONTEXT_DIR = join(ROOT, "src/i18n/context");
export const GLOSSARY_PATH = join(ROOT, "src/i18n/glossary.json");
export const SOURCE_LOCALE = "en";

export interface Glossary {
  doNotTranslate: string[];
  terms: Record<string, Record<string, string>>;
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function listLocales(): string[] {
  return readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function listNamespaces(locale: string): string[] {
  const dir = join(LOCALES_DIR, locale);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .sort();
}

export function readCatalog(locale: string, namespace: string): Record<string, unknown> {
  const path = join(LOCALES_DIR, locale, `${namespace}.json`);
  return existsSync(path) ? readJson<Record<string, unknown>>(path) : {};
}

export function readFlatCatalog(locale: string, namespace: string): FlatCatalog {
  return flattenCatalog(readCatalog(locale, namespace));
}

export function readContext(namespace: string): Map<string, string> {
  const path = join(CONTEXT_DIR, `${namespace}.json`);
  return existsSync(path) ? flattenCatalog(readJson(path)) : new Map();
}

export function readGlossary(): Glossary {
  return readJson<Glossary>(GLOSSARY_PATH);
}

export function unflatten(entries: Iterable<[string, string]>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    const parts = key.split(".");
    let node = out;
    for (const part of parts.slice(0, -1)) {
      const next = node[part];
      if (!next || typeof next !== "object") node[part] = {};
      node = node[part] as Record<string, unknown>;
    }
    node[parts[parts.length - 1] ?? key] = value;
  }
  return out;
}

export function writeCatalog(locale: string, namespace: string, sourceOrder: FlatCatalog, values: FlatCatalog): void {
  const ordered: [string, string][] = [];
  for (const key of sourceOrder.keys()) {
    const value = values.get(key);
    if (value !== undefined) ordered.push([key, value]);
  }
  mkdirSync(join(LOCALES_DIR, locale), { recursive: true });
  writeFileSync(join(LOCALES_DIR, locale, `${namespace}.json`), `${JSON.stringify(unflatten(ordered), null, 2)}\n`);
}
