import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import {
  DEFAULT_LOCALE,
  isLocalePreference,
  LOCALE_INFO,
  resolvePreference,
  SUPPORTED_LOCALES,
  type LocalePreference,
  type SupportedLocale,
} from "@oleafly/i18n-contract";
import { englishResources, loadLocaleResources, NAMESPACES, type Catalog } from "./resources";

export const LOCALE_STORAGE_KEY = "oleafly.locale";
export const LOCALE_CHANGED_EVENT = "i18n:locale-changed";

export type MissingKeyMode = "throw" | "warn" | "log";

export const i18n = createInstance();
i18n.use(initReactI18next);

let current: SupportedLocale = DEFAULT_LOCALE;
const listeners = new Set<(locale: SupportedLocale) => void>();
const warned = new Set<string>();

export function currentLocale(): SupportedLocale {
  return current;
}

export function onLocaleApplied(listener: (locale: SupportedLocale) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function readCachedPreference(): LocalePreference {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocalePreference(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

export function cachePreference(preference: LocalePreference): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, preference);
  } catch {
    return;
  }
}

function setDocumentLocale(locale: SupportedLocale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  document.documentElement.dir = LOCALE_INFO[locale].dir;
}

function missingKeyHandler(mode: MissingKeyMode) {
  return (languages: readonly string[], namespace: string, key: string) => {
    const id = `${namespace}:${key}`;
    if (mode === "throw") throw new Error(`missing translation ${id} for ${languages.join(",")}`);
    if (warned.has(id)) return;
    warned.add(id);
    if (mode === "warn") console.warn(`[i18n] missing translation ${id}`);
  };
}

export interface InitializeOptions {
  preference: LocalePreference;
  systemLocale: () => Promise<string | null>;
  missingKeyMode: MissingKeyMode;
}

function initOptions(
  locale: SupportedLocale,
  resources: Record<string, Record<string, Catalog>>,
  mode: MissingKeyMode,
) {
  return {
    lng: locale,
    fallbackLng: "en",
    supportedLngs: [...SUPPORTED_LOCALES],
    load: "currentOnly" as const,
    ns: [...NAMESPACES],
    defaultNS: "common",
    resources,
    enableSelector: "strict" as const,
    interpolation: { escapeValue: false },
    returnNull: false,
    returnEmptyString: false,
    saveMissing: true,
    missingKeyHandler: missingKeyHandler(mode),
  };
}

export async function initializeI18n(options: InitializeOptions): Promise<SupportedLocale> {
  const systemTag = options.preference === "system" ? await options.systemLocale() : null;
  const locale = resolvePreference(options.preference, systemTag);
  const resources: Record<string, Record<string, Catalog>> = { en: englishResources };
  if (locale !== "en") resources[locale] = await loadLocaleResources(locale);
  await i18n.init(initOptions(locale, resources, options.missingKeyMode));
  current = locale;
  setDocumentLocale(locale);
  return locale;
}

const buildMode = (import.meta as { env?: { MODE?: string } }).env?.MODE;

if (buildMode === "test" || buildMode === undefined) {
  void i18n.init(initOptions(DEFAULT_LOCALE, { en: englishResources }, "throw"));
  setDocumentLocale(DEFAULT_LOCALE);
}

export async function applyLocale(locale: SupportedLocale): Promise<void> {
  if (!i18n.hasResourceBundle(locale, "common")) {
    const resources = await loadLocaleResources(locale);
    for (const [namespace, catalog] of Object.entries(resources)) {
      i18n.addResourceBundle(locale, namespace, catalog, true, true);
    }
  }
  await i18n.changeLanguage(locale);
  current = locale;
  setDocumentLocale(locale);
  for (const listener of listeners) listener(locale);
}
