import { i18n } from "./index";
import type { Catalog } from "./resources";

type CatalogGlob = Record<string, () => Promise<Catalog>>;

function catalogGlob(): CatalogGlob {
  try {
    return import.meta.glob<Catalog>(["./locales/*/settingsFile.json", "./locales/*/cloud.json"], { import: "default" });
  } catch {
    return {};
  }
}

const catalogs = catalogGlob();
const requested = new Set<string>();

export const LAZY_NAMESPACES: readonly string[] = ["settingsFile", "cloud"];

export function loadCatalog(locale: string, namespace: string): Promise<Catalog> | null {
  return catalogs[`./locales/${locale}/${namespace}.json`]?.() ?? null;
}

async function addBundle(locale: string, namespace: string): Promise<void> {
  if (i18n.hasResourceBundle(locale, namespace)) return;
  const catalog = await loadCatalog(locale, namespace);
  if (catalog) i18n.addResourceBundle(locale, namespace, catalog, true, true);
}

function loadForLanguage(locale: string): void {
  for (const namespace of requested) addBundle(locale, namespace).catch(() => undefined);
}

export async function loadNamespace(namespace: string): Promise<void> {
  if (requested.size === 0) i18n.on("languageChanged", loadForLanguage);
  requested.add(namespace);
  await Promise.all([addBundle("en", namespace), addBundle(i18n.language, namespace)]);
}
