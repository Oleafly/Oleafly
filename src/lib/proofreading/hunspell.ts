import type { Hunspell } from "hunspell-asm";

const DICTIONARY_LOCALE = /^[A-Za-z]{2,3}_[A-Za-z]{2,4}$/u;
const SHIPPED_DICTIONARY_LOCALES = new Set([
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

/**
 * Loads the exact shipped Hunspell pack selected by the user. This function is
 * shared by the production worker and the browser E2E smoke so tests exercise
 * the same WASM, fetch, mount, and dictionary creation path.
 */
export async function loadHunspellDictionary(
  locale: string,
  baseUrl = dictionaryBaseUrl(),
): Promise<Hunspell> {
  const safeLocale = locale.replace("-", "_");
  if (!DICTIONARY_LOCALE.test(safeLocale)) {
    throw new Error("Invalid spelling dictionary locale.");
  }
  // Development servers commonly serve index.html with a successful status
  // for unknown asset paths. Reject anything outside the packaged manifest
  // before fetching so a missing dictionary can never masquerade as a valid
  // Hunspell pack.
  if (!SHIPPED_DICTIONARY_LOCALES.has(safeLocale)) {
    throw new Error(
      `The requested ${safeLocale} spelling dictionary is unavailable.`,
    );
  }
  installModuleWorkerCompatibilityMarker();
  const { loadModule } = await import("hunspell-asm");
  const factory = await loadModule();
  const dictionaryUrl = (extension: "aff" | "dic") =>
    new URL(
      `dictionaries/${safeLocale}.${extension}`,
      baseUrl,
    );
  const [affResponse, dictionaryResponse] = await Promise.all([
    fetch(dictionaryUrl("aff")),
    fetch(dictionaryUrl("dic")),
  ]);
  if (!affResponse.ok || !dictionaryResponse.ok) {
    throw new Error(
      `The requested ${safeLocale} spelling dictionary is unavailable.`,
    );
  }
  const [aff, dictionary] = await Promise.all([
    affResponse.arrayBuffer(),
    dictionaryResponse.arrayBuffer(),
  ]);
  const affPath = factory.mountBuffer(
    new Uint8Array(aff),
    `${safeLocale}.aff`,
  );
  const dictionaryPath = factory.mountBuffer(
    new Uint8Array(dictionary),
    `${safeLocale}.dic`,
  );
  return factory.create(affPath, dictionaryPath);
}
