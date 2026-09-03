import type {
  BibliographyEntry,
  FileIntelligence,
  ProjectDefinition,
  ProjectDiagnostic,
  ProjectEdge,
  ProjectIntelligenceSnapshot,
  ProjectUse,
} from "./types";

interface GroupedByFile {
  readonly definitions: ReadonlyMap<string, readonly ProjectDefinition[]>;
  readonly uses: ReadonlyMap<string, readonly ProjectUse[]>;
  readonly edges: ReadonlyMap<string, readonly ProjectEdge[]>;
  readonly diagnostics: ReadonlyMap<string, readonly ProjectDiagnostic[]>;
  readonly bibliographyEntries: ReadonlyMap<
    string,
    readonly BibliographyEntry[]
  >;
}

interface FileViewCache {
  grouped: GroupedByFile | null;
  readonly files: Map<string, FileIntelligence>;
  record: Readonly<Record<string, FileIntelligence>> | null;
}

const caches = new WeakMap<ProjectIntelligenceSnapshot, FileViewCache>();

function groupByFile<T>(
  items: readonly T[],
  fileOf: (item: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const file = fileOf(item);
    const existing = groups.get(file);
    if (existing) existing.push(item);
    else groups.set(file, [item]);
  }
  return groups;
}

function groupSnapshot(snapshot: ProjectIntelligenceSnapshot): GroupedByFile {
  return {
    definitions: groupByFile(
      snapshot.definitions,
      (definition) => definition.location.file,
    ),
    uses: groupByFile(snapshot.uses, (use) => use.location.file),
    edges: groupByFile(snapshot.hierarchy.edges, (edge) => edge.fromFile),
    diagnostics: groupByFile(
      snapshot.diagnostics,
      (diagnostic) => diagnostic.location.file,
    ),
    bibliographyEntries: groupByFile(
      snapshot.bibliography.entries,
      (entry) => entry.file,
    ),
  };
}

function cacheFor(snapshot: ProjectIntelligenceSnapshot): FileViewCache {
  const existing = caches.get(snapshot);
  if (existing) return existing;
  const created: FileViewCache = {
    grouped: null,
    files: new Map(),
    record: null,
  };
  caches.set(snapshot, created);
  return created;
}

export function fileIntelligenceFor(
  snapshot: ProjectIntelligenceSnapshot,
  path: string,
): FileIntelligence | null {
  const state = snapshot.fileStates[path];
  if (!state) return null;
  const cache = cacheFor(snapshot);
  const built = cache.files.get(path);
  if (built) return built;
  cache.grouped ??= groupSnapshot(snapshot);
  const file: FileIntelligence = {
    ...state,
    outline: snapshot.outlines[path] ?? [],
    definitions: cache.grouped.definitions.get(path) ?? [],
    uses: cache.grouped.uses.get(path) ?? [],
    edges: cache.grouped.edges.get(path) ?? [],
    diagnostics: cache.grouped.diagnostics.get(path) ?? [],
    bibliographyEntries: cache.grouped.bibliographyEntries.get(path) ?? [],
  };
  cache.files.set(path, file);
  return file;
}

export function fileIntelligenceView(
  snapshot: ProjectIntelligenceSnapshot,
): Readonly<Record<string, FileIntelligence>> {
  const cache = cacheFor(snapshot);
  if (cache.record) return cache.record;
  const record: Record<string, FileIntelligence> = {};
  for (const path of Object.keys(snapshot.fileStates)) {
    Object.defineProperty(record, path, {
      enumerable: true,
      get: () => fileIntelligenceFor(snapshot, path) as FileIntelligence,
    });
  }
  cache.record = record;
  return record;
}
