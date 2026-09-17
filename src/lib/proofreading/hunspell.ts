import type { Hunspell } from "hunspell-asm";

export type DictionaryLoadReason =
  | "unavailable"
  | "not_installed"
  | "load_failed";

export class DictionaryLoadError extends Error {
  constructor(
    readonly locale: string,
    readonly reason: DictionaryLoadReason,
  ) {
    super(`The ${locale} spelling dictionary could not be loaded.`);
    this.name = "DictionaryLoadError";
  }
}

export interface DictionaryPayload {
  aff: Uint8Array;
  dic: Uint8Array;
}

const DICTIONARY_LOCALE = /^[a-z]{2,3}(?:_[A-Za-z]{2,4})?$/u;
const BUNDLED_DICTIONARY_LOCALES = new Set([
  "de_DE",
  "en_AU",
  "en_GB",
  "en_US",
  "fr_FR",
]);

function dictionaryBaseUrl(): string {
  const current = globalThis.location;
  if (current?.origin && current.origin !== "null") {
    return `${current.origin}/`;
  }
  return current?.href ?? "http://localhost/";
}

function installModuleWorkerCompatibilityMarker(): void {
  if (typeof document !== "undefined") return;
  const workerGlobals = globalThis as typeof globalThis & {
    importScripts?: (...urls: string[]) => void;
  };
  if (typeof workerGlobals.importScripts === "function") return;
  Object.defineProperty(workerGlobals, "importScripts", {
    configurable: true,
    value: () => {
      throw new Error(
        "Dynamic script loading is disabled in the proofreading worker.",
      );
    },
  });
}

export function normalizeDictionaryLocaleId(locale: string): string {
  return locale.trim().replace("-", "_");
}

export function isBundledDictionaryLocale(locale: string): boolean {
  return BUNDLED_DICTIONARY_LOCALES.has(normalizeDictionaryLocaleId(locale));
}

async function fetchBundledPayload(
  locale: string,
  baseUrl: string,
): Promise<DictionaryPayload> {
  const address = (extension: "aff" | "dic") =>
    new URL(`dictionaries/${locale}.${extension}`, baseUrl);
  const [affResponse, dictionaryResponse] = await Promise.all([
    fetch(address("aff")),
    fetch(address("dic")),
  ]);
  if (!affResponse.ok || !dictionaryResponse.ok) {
    throw new DictionaryLoadError(locale, "load_failed");
  }
  const [aff, dic] = await Promise.all([
    affResponse.arrayBuffer(),
    dictionaryResponse.arrayBuffer(),
  ]);
  return { aff: new Uint8Array(aff), dic: new Uint8Array(dic) };
}

async function createHunspell(
  locale: string,
  payload: DictionaryPayload,
): Promise<Hunspell> {
  if (payload.aff.byteLength === 0 || payload.dic.byteLength === 0) {
    throw new DictionaryLoadError(locale, "load_failed");
  }
  installModuleWorkerCompatibilityMarker();
  const { loadModule } = await import("hunspell-asm");
  const factory = await loadModule();
  const affPath = factory.mountBuffer(payload.aff, `${locale}.aff`);
  const dictionaryPath = factory.mountBuffer(payload.dic, `${locale}.dic`);
  return factory.create(affPath, dictionaryPath);
}

export async function loadHunspellDictionary(
  locale: string,
  options: { baseUrl?: string; payload?: DictionaryPayload } = {},
): Promise<Hunspell> {
  const safeLocale = normalizeDictionaryLocaleId(locale);
  if (!DICTIONARY_LOCALE.test(safeLocale)) {
    throw new DictionaryLoadError(safeLocale, "unavailable");
  }
  if (options.payload) {
    return createHunspell(safeLocale, options.payload);
  }
  if (!BUNDLED_DICTIONARY_LOCALES.has(safeLocale)) {
    throw new DictionaryLoadError(safeLocale, "not_installed");
  }
  const payload = await fetchBundledPayload(
    safeLocale,
    options.baseUrl ?? dictionaryBaseUrl(),
  );
  return createHunspell(safeLocale, payload);
}
