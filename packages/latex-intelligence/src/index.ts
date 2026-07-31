import type { CoreCatalog, NameList, PackageCatalog } from "./types";
import { validateCoreCatalog, validateNameList, validatePackageCatalog } from "./validate";

export type {
  CoreCatalog,
  CoreCommand,
  CoreEnvironment,
  CorpusEnvironment,
  CorpusMacro,
  Manifest,
  NameList,
  PackageCatalog,
} from "./types";
export { validateCoreCatalog, validateManifest, validateNameList, validatePackageCatalog } from "./validate";

/** Matches every generated basename under data/packages (classes are `class-<name>`). */
const PACKAGE_NAME_RE = /^[A-Za-z0-9@_+-]+$/;
const PACKAGE_CACHE_CAP = 32;
const DEFAULT_CLOSURE_CAP = 64;

function unwrapModule(module: unknown): unknown {
  if (typeof module === "object" && module !== null && "default" in module) {
    return (module as { default: unknown }).default;
  }
  return module;
}

let corePromise: Promise<CoreCatalog | null> | null = null;

/** Load the default command/environment catalog. Cached; null on failure. */
export function loadCore(): Promise<CoreCatalog | null> {
  corePromise ??= import("../data/core.json")
    .then((module) => validateCoreCatalog(unwrapModule(module)))
    .catch((error: unknown) => {
      console.debug("[latex-intelligence] failed to load core catalog", error);
      return null;
    });
  return corePromise;
}

let packageNamesPromise: Promise<NameList | null> | null = null;

/** Load the CTAN-derived package name list. Cached; null on failure. */
export function loadPackageNames(): Promise<NameList | null> {
  packageNamesPromise ??= import("../data/package-names.json")
    .then((module) => validateNameList(unwrapModule(module)))
    .catch((error: unknown) => {
      console.debug("[latex-intelligence] failed to load package names", error);
      return null;
    });
  return packageNamesPromise;
}

let classNamesPromise: Promise<NameList | null> | null = null;

/** Load the CTAN-derived document class name list. Cached; null on failure. */
export function loadClassNames(): Promise<NameList | null> {
  classNamesPromise ??= import("../data/class-names.json")
    .then((module) => validateNameList(unwrapModule(module)))
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
  const loaded = import(`../data/packages/${name}.json`)
    .then((module) => validatePackageCatalog(unwrapModule(module)))
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
