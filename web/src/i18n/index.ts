import { DEFAULT_LOCALE, LOCALE_INFO, SUPPORTED_LOCALES, type SupportedLocale } from "@oleafly/i18n-contract";
import { createInstance, type ResourceKey } from "i18next";
import { initReactI18next } from "react-i18next";
import web from "./en.json";
import { browserLanguages, resolveWebLocale } from "./locale";

type Catalog = { [key: string]: ResourceKey };
type CatalogLoaders = Record<string, () => Promise<Catalog>>;

const DESKTOP_LOCALES = "../../../src/i18n/locales";

const webCatalogs: CatalogLoaders = import.meta.glob<Catalog>(["./*.json", "!./en.json"], { import: "default" });

const packageCatalogs: CatalogLoaders = import.meta.glob<Catalog>(
  [
    "../../../src/i18n/locales/*/editor.json",
    "../../../src/i18n/locales/*/preview.json",
    "!../../../src/i18n/locales/en/*.json",
  ],
  { import: "default" },
);

const PACKAGE_NAMESPACES = ["editor", "preview"] as const;

export const webI18n = createInstance();
webI18n.use(initReactI18next);

let ready: Promise<SupportedLocale> | null = null;

function load(loaders: CatalogLoaders, path: string): Promise<Catalog | null> {
  const loader = loaders[path];
  return loader ? loader() : Promise.resolve(null);
}

function packageMessages(catalog: Catalog | null): Catalog | null {
  const messages = catalog?.package;
  return messages && typeof messages === "object" ? { package: messages } : null;
}

function setDocumentLocale(locale: SupportedLocale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  document.documentElement.dir = LOCALE_INFO[locale].dir;
}

export async function loadWebLocale(locale: SupportedLocale): Promise<boolean> {
  if (locale === DEFAULT_LOCALE) return true;
  if (webI18n.hasResourceBundle(locale, "web")) return true;
  const [own, ...packages] = await Promise.all([
    load(webCatalogs, `./${locale}.json`),
    ...PACKAGE_NAMESPACES.map((namespace) => load(packageCatalogs, `${DESKTOP_LOCALES}/${locale}/${namespace}.json`)),
  ]);
  if (!own) return false;
  PACKAGE_NAMESPACES.forEach((namespace, index) => {
    const messages = packageMessages(packages[index] ?? null);
    if (messages) webI18n.addResourceBundle(locale, namespace, messages, true, true);
  });
  webI18n.addResourceBundle(locale, "web", own, true, true);
  return true;
}

export async function applyWebLocale(locale: SupportedLocale): Promise<SupportedLocale> {
  const loaded = await loadWebLocale(locale).catch(() => false);
  const next = loaded ? locale : DEFAULT_LOCALE;
  await webI18n.changeLanguage(next);
  setDocumentLocale(next);
  return next;
}

async function start(locale: SupportedLocale): Promise<SupportedLocale> {
  await webI18n.init({
    lng: DEFAULT_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...SUPPORTED_LOCALES],
    load: "currentOnly",
    ns: ["web"],
    defaultNS: "web",
    resources: { en: { web } },
    enableSelector: "strict",
    interpolation: { escapeValue: false },
    returnNull: false,
    returnEmptyString: false,
    initAsync: false,
  });
  return applyWebLocale(locale);
}

export function initializeWebI18n(locale: SupportedLocale = resolveWebLocale(browserLanguages())): Promise<SupportedLocale> {
  ready ??= start(locale);
  return ready;
}
