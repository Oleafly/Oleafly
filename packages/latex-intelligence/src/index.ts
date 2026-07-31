import type { AtSuggestion, CoreCatalog, NameList, PackageCatalog } from "./types";
import {
  validateAtSuggestions,
  validateCoreCatalog,
  validateNameList,
  validatePackageCatalog,
} from "./validate";

export type {
  AtSuggestion,
  CoreCatalog,
  CoreCommand,
  CoreEnvironment,
  CorpusEnvironment,
  CorpusMacro,
  Manifest,
  NameList,
  PackageCatalog,
} from "./types";
export {
  validateAtSuggestions,
  validateCoreCatalog,
  validateManifest,
  validateNameList,
  validatePackageCatalog,
} from "./validate";

/** Matches every generated basename under `packages/` (classes are `class-<name>`). */
const PACKAGE_NAME_RE = /^[A-Za-z0-9@_+-]+$/;
const PACKAGE_CACHE_CAP = 32;
const DEFAULT_CLOSURE_CAP = 64;

/**
 * Fetches one corpus JSON document by its path relative to the corpus root
 * (e.g. `core.json`, `packages/siunitx.json`). Resolves the parsed JSON, or
 * null when the document is unavailable. May also reject; loaders treat a
 * rejection like a null.
 */
export type CorpusTransport = (relativePath: string) => Promise<unknown | null>;

/**
 * Base URL for the corpus shipped under `public/latex-intelligence`. Mirrors
 * the worker-safe resolution used by the Hunspell dictionary loader: prefer
 * the document/worker origin, fall back to the current href (workers created
 * from blob/opaque origins), then to a fixed host so `new URL` cannot throw.
 */
function corpusBaseUrl(): string {
  try {
    const current = globalThis.location;
    const base =
      current?.origin && current.origin !== "null"
        ? `${current.origin}/`
        : (current?.href ?? "http://localhost/");
    return new URL("latex-intelligence/", base).toString();
  } catch {
    return "/latex-intelligence/";
  }
}

// Development servers commonly serve index.html with a successful status for
// unknown asset paths, and content types are not reliable across bundler dev
// servers. So the transport only requires a parseable JSON body; every load
// site below still validates the payload shape before trusting it.
const defaultCorpusTransport: CorpusTransport = async (relativePath) => {
  const response = await fetch(`${corpusBaseUrl()}${relativePath}`);
  if (!response.ok) return null;
  return response.json().catch(() => null);
};

let activeTransport: CorpusTransport = defaultCorpusTransport;

/**
 * Override how corpus JSON documents are fetched (tests, non-browser hosts).
 * Pass null to restore the default fetch-based transport. Already-cached
 * loads are not invalidated.
 */
export function setCorpusTransport(transport: CorpusTransport | null): void {
  activeTransport = transport ?? defaultCorpusTransport;
}

// Async so a transport that throws synchronously still surfaces as a
// rejection, which every loader below catches and caches as null.
async function requestCorpus(relativePath: string): Promise<unknown | null> {
  return activeTransport(relativePath);
}

let corePromise: Promise<CoreCatalog | null> | null = null;

/** Load the default command/environment catalog. Cached; null on failure. */
export function loadCore(): Promise<CoreCatalog | null> {
  corePromise ??= requestCorpus("core.json")
    .then((payload) => validateCoreCatalog(payload))
    .catch((error: unknown) => {
      console.debug("[latex-intelligence] failed to load core catalog", error);
      return null;
    });
  return corePromise;
}

let atSuggestionsPromise: Promise<AtSuggestion[] | null> | null = null;

/** Load the math-mode `@` shortcut snippets. Cached; null on failure. */
export function loadAtSuggestions(): Promise<AtSuggestion[] | null> {
  atSuggestionsPromise ??= requestCorpus("at-suggestions.json")
    .then((payload) => validateAtSuggestions(payload))
    .catch((error: unknown) => {
      console.debug("[latex-intelligence] failed to load at-suggestions", error);
      return null;
    });
  return atSuggestionsPromise;
}

let packageNamesPromise: Promise<NameList | null> | null = null;

/** Load the CTAN-derived package name list. Cached; null on failure. */
export function loadPackageNames(): Promise<NameList | null> {
  packageNamesPromise ??= requestCorpus("package-names.json")
    .then((payload) => validateNameList(payload))
    .catch((error: unknown) => {
      console.debug("[latex-intelligence] failed to load package names", error);
      return null;
    });
  return packageNamesPromise;
}

let classNamesPromise: Promise<NameList | null> | null = null;

/** Load the CTAN-derived document class name list. Cached; null on failure. */
export function loadClassNames(): Promise<NameList | null> {
  classNamesPromise ??= requestCorpus("class-names.json")
    .then((payload) => validateNameList(payload))
    .catch((error: unknown) => {
      console.debug("[latex-intelligence] failed to load class names", error);
      return null;
    });
  return classNamesPromise;
}

const packageCache = new Map<string, Promise<PackageCatalog | null>>();

/**
 * Load one package (or `class-<name>` class) catalog. Results — including
 * failures, which resolve to null — are cached in an LRU capped at
 * 32 catalogs.
 */
export function loadPackageCatalog(name: string): Promise<PackageCatalog | null> {
  if (!PACKAGE_NAME_RE.test(name)) return Promise.resolve(null);
  const cached = packageCache.get(name);
  if (cached) {
    // Refresh recency.
    packageCache.delete(name);
    packageCache.set(name, cached);
    return cached;
  }
  const loaded = requestCorpus(`packages/${name}.json`)
    .then((payload) => validatePackageCatalog(payload))
    .catch((error: unknown) => {
      console.debug(`[latex-intelligence] failed to load package catalog "${name}"`, error);
      return null;
    });
  packageCache.set(name, loaded);
  while (packageCache.size > PACKAGE_CACHE_CAP) {
    const oldest = packageCache.keys().next().value;
    if (oldest === undefined) break;
    packageCache.delete(oldest);
  }
  return loaded;
}

/**
 * Resolve the given package names plus one level of their dependencies into
 * loaded catalogs, stopping once `cap` catalogs are loaded.
 */
export async function resolvePackageClosure(
  names: readonly string[],
  lookup: (name: string) => Promise<PackageCatalog | null>,
  cap: number = DEFAULT_CLOSURE_CAP,
): Promise<Map<string, PackageCatalog>> {
  const resolved = new Map<string, PackageCatalog>();
  const attempted = new Set<string>();
  const dependencies: string[] = [];
  for (const name of names) {
    if (resolved.size >= cap) return resolved;
    if (attempted.has(name)) continue;
    attempted.add(name);
    const catalog = await lookup(name);
    if (catalog) {
      resolved.set(name, catalog);
      dependencies.push(...catalog.deps);
    }
  }
  for (const name of dependencies) {
    if (resolved.size >= cap) return resolved;
    if (attempted.has(name)) continue;
    attempted.add(name);
    const catalog = await lookup(name);
    if (catalog) resolved.set(name, catalog);
  }
  return resolved;
}
