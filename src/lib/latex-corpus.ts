import { snippet, type Completion } from "@codemirror/autocomplete";
import { setLatexCorpusProvider } from "@oleafly/editor";
import {
  loadClassNames,
  loadCore,
  loadPackageCatalog,
  loadPackageNames,
  type CoreCatalog,
  type CorpusMacro,
  type NameList,
  type PackageCatalog,
} from "@oleafly/latex-intelligence";
import { useIndexStore } from "@/store/project-index";

// Completion sources are synchronous, so the corpus is cached here and every
// getter returns null until its background load resolves. Callers fall back
// to the small built-in lists in the meantime; the next completion query
// after a load sees the full data.

const CLOSURE_CAP = 64;

let core: CoreCatalog | null = null;
let packageNames: NameList | null = null;
let classNames: NameList | null = null;
let baseRequested = false;

function ensureBaseCorpus(): void {
  if (baseRequested) return;
  baseRequested = true;
  void loadCore().then((value) => {
    core = value;
  });
  void loadPackageNames().then((value) => {
    packageNames = value;
  });
  void loadClassNames().then((value) => {
    classNames = value;
  });
}

export function corpusCore(): CoreCatalog | null {
  ensureBaseCorpus();
  return core;
}

export function corpusPackageNames(): NameList | null {
  ensureBaseCorpus();
  return packageNames;
}

export function corpusClassNames(): NameList | null {
  ensureBaseCorpus();
  return classNames;
}

const loadedCatalogs = new Map<string, PackageCatalog>();
const requested = new Set<string>();

function requestCatalog(name: string, expandDeps: boolean): void {
  if (requested.has(name) || requested.size >= CLOSURE_CAP) return;
  requested.add(name);
  void loadPackageCatalog(name).then((catalog) => {
    if (!catalog) return;
    loadedCatalogs.set(name, catalog);
    if (!expandDeps) return;
    for (const dep of catalog.deps) {
      requestCatalog(dep, false);
    }
  });
}

/** Kick off background loads for the given package/class catalog names. */
export function requestPackageCatalogs(names: readonly string[]): void {
  for (const name of names) {
    requestCatalog(name, true);
  }
}

/** Already-loaded catalogs (name → catalog) for the given names plus deps. */
export function loadedCatalogsFor(
  names: readonly string[],
): Map<string, PackageCatalog> {
  const result = new Map<string, PackageCatalog>();
  for (const name of names) {
    const catalog = loadedCatalogs.get(name);
    if (!catalog) continue;
    result.set(name, catalog);
    for (const dep of catalog.deps) {
      const dependency = loadedCatalogs.get(dep);
      if (dependency) result.set(dep, dependency);
    }
  }
  return result;
}

export function catalogNamesForSnapshot(snapshot: {
  readonly detectedPackages: readonly string[];
  readonly documentClasses: readonly string[];
}): string[] {
  return [
    ...snapshot.detectedPackages,
    ...snapshot.documentClasses.map((name) => `class-${name}`),
  ];
}

function completionForCorpusMacro(
  macro: CorpusMacro,
  detail: string,
): Completion {
  return {
    label: `\\${macro.name}`,
    type: "function",
    detail: macro.detail || detail,
    ...(macro.documentation
      ? { info: macro.documentation }
      : {}),
    apply: macro.snippet ? snippet(`\\${macro.snippet}`) : undefined,
  };
}

let coreCommandCompletions: Completion[] | null = null;

let subscribed = false;

/**
 * Register the corpus with the editor package and keep package catalogs
 * warm for whatever the project-intelligence snapshot detects.
 */
export function installLatexCorpus(): void {
  if (subscribed) return;
  subscribed = true;
  ensureBaseCorpus();
  setLatexCorpusProvider({
    coreCommands: () => {
      if (!core) return null;
      coreCommandCompletions ??= core.commands.map((command) =>
        completionForCorpusMacro(command, "LaTeX command"),
      );
      return coreCommandCompletions;
    },
  });
  useIndexStore.subscribe((state) => {
    const snapshot = state.intelligenceState?.data;
    if (!snapshot) return;
    requestPackageCatalogs(catalogNamesForSnapshot(snapshot));
  });
}
