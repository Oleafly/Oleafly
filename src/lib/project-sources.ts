import type {
  BackendPort,
  ProjectSourcesRequest,
  ProjectSourcesResult,
} from "@oleafly/backend-port";
import * as tauri from "@/lib/tauri";

const FALLBACK_READ_CONCURRENCY = 8;
const MAX_CACHED_CHARACTERS = 10_000_000;

interface CachedSource {
  readonly hash: string;
  readonly text: string;
}

export interface ProjectSourcesBatch {
  texts: Record<string, string>;
  unreadable: Set<string>;
}

export interface ProjectSourcesBatchStats {
  invokes: number;
  fallbackReads: number;
  transferredCharacters: number;
}

type BatchBinding = NonNullable<BackendPort["readProjectSourcesBatch"]>;

let cacheProjectId: string | null = null;
let cache = new Map<string, CachedSource>();
let cachedCharacters = 0;

const stats: ProjectSourcesBatchStats = {
  invokes: 0,
  fallbackReads: 0,
  transferredCharacters: 0,
};

export function normalizeSourceText(text: string): string {
  return text.replace(/\r\n?/gu, "\n");
}

export function resetProjectSourcesCache(projectId?: string): void {
  if (projectId !== undefined && cacheProjectId !== projectId) return;
  cacheProjectId = null;
  cache = new Map();
  cachedCharacters = 0;
}

export function projectSourcesCacheSize(): number {
  return cache.size;
}

export function projectSourcesBatchStats(): ProjectSourcesBatchStats {
  return { ...stats };
}

export function resetProjectSourcesBatchStats(): void {
  stats.invokes = 0;
  stats.fallbackReads = 0;
  stats.transferredCharacters = 0;
}

function batchBinding(): BatchBinding | null {
  const candidate = (tauri as Partial<BackendPort>).readProjectSourcesBatch;
  return typeof candidate === "function" ? candidate : null;
}

function activateProject(projectId: string): void {
  if (cacheProjectId === projectId) return;
  resetProjectSourcesCache();
  cacheProjectId = projectId;
}

function remember(path: string, hash: string, text: string): void {
  const previous = cache.get(path);
  if (previous) cachedCharacters -= previous.text.length;
  cache.set(path, { hash, text });
  cachedCharacters += text.length;
}

function forget(path: string): void {
  const previous = cache.get(path);
  if (!previous) return;
  cache.delete(path);
  cachedCharacters -= previous.text.length;
}

function evictOutside(requested: ReadonlySet<string>): void {
  if (cachedCharacters <= MAX_CACHED_CHARACTERS) return;
  for (const [path, entry] of cache) {
    if (requested.has(path)) continue;
    cache.delete(path);
    cachedCharacters -= entry.text.length;
  }
  while (cachedCharacters > MAX_CACHED_CHARACTERS && cache.size > 0) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    const entry = cache.get(oldest);
    cache.delete(oldest);
    if (entry) cachedCharacters -= entry.text.length;
  }
}

async function readIndividually(
  projectId: string,
  paths: readonly string[],
  into: ProjectSourcesBatch,
): Promise<void> {
  let cursor = 0;
  const readers = Array.from(
    {
      length: Math.min(FALLBACK_READ_CONCURRENCY, Math.max(1, paths.length)),
    },
    async () => {
      for (;;) {
        const index = cursor++;
        if (index >= paths.length) return;
        const path = paths[index];
        try {
          stats.fallbackReads += 1;
          const text = normalizeSourceText(
            await tauri.readFileContent(projectId, path),
          );
          stats.transferredCharacters += text.length;
          into.texts[path] = text;
        } catch {
          into.unreadable.add(path);
        }
      }
    },
  );
  await Promise.all(readers);
}

async function readThroughBatch(
  binding: BatchBinding,
  projectId: string,
  paths: readonly string[],
  into: ProjectSourcesBatch,
): Promise<void> {
  const request: ProjectSourcesRequest = {
    paths: [...paths],
    known: paths.flatMap((path) => {
      const entry = cache.get(path);
      return entry ? [{ path, hash: entry.hash }] : [];
    }),
  };
  stats.invokes += 1;
  const result: ProjectSourcesResult = await binding(projectId, request);
  const requested = new Set(paths);
  const seen = new Set<string>();
  for (const file of result.files) {
    if (!requested.has(file.path)) continue;
    const text = normalizeSourceText(file.text);
    stats.transferredCharacters += file.text.length;
    remember(file.path, file.hash, text);
    into.texts[file.path] = text;
    seen.add(file.path);
  }
  const missing: string[] = [];
  for (const path of result.unchanged) {
    if (!requested.has(path) || seen.has(path)) continue;
    const entry = cache.get(path);
    if (entry) {
      into.texts[path] = entry.text;
      seen.add(path);
    } else {
      missing.push(path);
    }
  }
  for (const entry of result.unreadable) {
    if (!requested.has(entry.path) || seen.has(entry.path)) continue;
    forget(entry.path);
    into.unreadable.add(entry.path);
    seen.add(entry.path);
  }
  for (const path of result.oversized ?? []) {
    if (!requested.has(path) || seen.has(path)) continue;
    forget(path);
    missing.push(path);
    seen.add(path);
  }
  for (const path of paths) {
    if (!seen.has(path) && !into.unreadable.has(path)) missing.push(path);
  }
  evictOutside(requested);
  if (missing.length > 0) {
    await readIndividually(projectId, [...new Set(missing)], into);
  }
}

export async function readProjectSourcesBatch(
  projectId: string,
  paths: readonly string[],
): Promise<ProjectSourcesBatch> {
  const into: ProjectSourcesBatch = { texts: {}, unreadable: new Set() };
  const unique = [...new Set(paths)];
  if (unique.length === 0) return into;
  activateProject(projectId);
  const binding = batchBinding();
  if (!binding) {
    await readIndividually(projectId, unique, into);
    return into;
  }
  try {
    await readThroughBatch(binding, projectId, unique, into);
  } catch {
    resetProjectSourcesCache(projectId);
    into.texts = {};
    into.unreadable = new Set();
    await readIndividually(projectId, unique, into);
  }
  return into;
}
