import type { ResourceKey } from "i18next";
import type { SupportedLocale } from "@oleafly/i18n-contract";
import ai from "./locales/en/ai.json" with { type: "json" };
import catalog from "./locales/en/catalog.json" with { type: "json" };
import common from "./locales/en/common.json" with { type: "json" };
import core from "./locales/en/core.json" with { type: "json" };
import diagram from "./locales/en/diagram.json" with { type: "json" };
import editor from "./locales/en/editor.json" with { type: "json" };
import errors from "./locales/en/errors.json" with { type: "json" };
import intelligence from "./locales/en/intelligence.json" with { type: "json" };
import library from "./locales/en/library.json" with { type: "json" };
import native from "./locales/en/native.json" with { type: "json" };
import onboarding from "./locales/en/onboarding.json" with { type: "json" };
import preflight from "./locales/en/preflight.json" with { type: "json" };
import preview from "./locales/en/preview.json" with { type: "json" };
import references from "./locales/en/references.json" with { type: "json" };
import researchTools from "./locales/en/researchTools.json" with { type: "json" };
import settings from "./locales/en/settings.json" with { type: "json" };
import shell from "./locales/en/shell.json" with { type: "json" };
import symbols from "./locales/en/symbols.json" with { type: "json" };
import templates from "./locales/en/templates.json" with { type: "json" };
import usage from "./locales/en/usage.json" with { type: "json" };
import workspace from "./locales/en/workspace.json" with { type: "json" };

export type Catalog = { [key: string]: ResourceKey };

type CatalogGlob = Record<string, () => Promise<Catalog>>;

function lazyCatalogGlob(): CatalogGlob {
  try {
    return import.meta.glob<Catalog>(["./locales/*/*.json", "!./locales/en/*.json"], { import: "default" });
  } catch {
    return {};
  }
}

const lazyCatalogs = lazyCatalogGlob();

function namespaceOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1, -".json".length);
}

export const englishResources: Record<string, Catalog> = {
  ai,
  catalog,
  common,
  core,
  diagram,
  editor,
  errors,
  intelligence,
  library,
  native,
  onboarding,
  preflight,
  preview,
  references,
  researchTools,
  settings,
  shell,
  symbols,
  templates,
  usage,
  workspace,
};

export const NAMESPACES: readonly string[] = Object.keys(englishResources).sort();

export async function loadLocaleResources(locale: SupportedLocale): Promise<Record<string, Catalog>> {
  if (locale === "en") return englishResources;
  const prefix = `./locales/${locale}/`;
  const entries = await Promise.all(
    Object.entries(lazyCatalogs)
      .filter(([path]) => path.startsWith(prefix))
      .map(async ([path, load]) => [namespaceOf(path), await load()] as const),
  );
  return Object.fromEntries(entries);
}
