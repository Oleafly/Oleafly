import type { ZoteroHit } from "@oleafly/backend-port";
import { zoteroLibrarySearch } from "@/lib/tauri";
import { queryTerms, scoreCitation, type RankableCitation } from "./ranking";
import { plainText } from "./rich-text";

export const ZOTERO_SEARCH_LIMIT = 50;
const CACHE_LIMIT = 64;
const DEFAULT_DELAY_MS = 30;

export interface ZoteroSearchEntry {
  readonly generation: number;
  readonly total: number;
  readonly hits: readonly ZoteroHit[];
  readonly complete: boolean;
}

const cache = new Map<string, ZoteroSearchEntry>();
const inflight = new Map<string, Promise<ZoteroSearchEntry>>();

export function normalizeZoteroQuery(query: string): string {
  return query.trim().replace(/^@+/, "").replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function remember(query: string, entry: ZoteroSearchEntry): void {
  cache.delete(query);
  cache.set(query, entry);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function rankable(hit: ZoteroHit): RankableCitation {
  return { key: hit.citationKey, authors: hit.authors, title: plainText(hit.title), year: hit.year };
}

export function matchesZoteroQuery(hit: ZoteroHit, query: string): boolean {
  return scoreCitation(rankable(hit), query) !== null;
}

function narrowed(query: string, generation: number): ZoteroSearchEntry | null {
  let best: { query: string; entry: ZoteroSearchEntry } | null = null;
  for (const [cached, entry] of cache) {
    if (
      entry.generation === generation &&
      entry.complete &&
      cached.length < query.length &&
      query.startsWith(cached) &&
      (!best || cached.length > best.query.length)
    ) {
      best = { query: cached, entry };
    }
  }
  if (!best || queryTerms(best.query).terms.length === 0) return null;
  const scored = best.entry.hits
    .map((hit) => ({
      hit,
      score: scoreCitation(rankable(hit), query),
    }))
    .filter((candidate): candidate is { hit: ZoteroHit; score: number } => candidate.score !== null)
    .sort((left, right) => right.score - left.score);
  const hits = scored.map(({ hit, score }) => ({ ...hit, score }));
  return { generation, total: hits.length, hits, complete: true };
}

export function cachedZoteroSearch(query: string, generation: number): ZoteroSearchEntry | null {
  const normalized = normalizeZoteroQuery(query);
  const exact = cache.get(normalized);
  if (exact?.generation === generation) {
    remember(normalized, exact);
    return exact;
  }
  const derived = narrowed(normalized, generation);
  if (derived) remember(normalized, derived);
  return derived;
}

function abortError(): Error {
  const error = new Error("The Zotero search was cancelled");
  error.name = "AbortError";
  return error;
}

function wait(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) reject(abortError());
      else resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function searchZoteroLibrary(
  query: string,
  options: { generation: number; signal?: AbortSignal; delayMs?: number },
): Promise<ZoteroSearchEntry> {
  const cached = cachedZoteroSearch(query, options.generation);
  if (cached) return cached;
  const normalized = normalizeZoteroQuery(query);
  await wait(options.delayMs ?? DEFAULT_DELAY_MS, options.signal);
  const again = cachedZoteroSearch(normalized, options.generation);
  if (again) return again;
  let pending = inflight.get(normalized);
  if (!pending) {
    pending = zoteroLibrarySearch(normalized, ZOTERO_SEARCH_LIMIT)
      .then((reply) => {
        const entry: ZoteroSearchEntry = {
          generation: reply.generation,
          total: reply.total,
          hits: reply.hits,
          complete: reply.total <= reply.hits.length,
        };
        remember(normalized, entry);
        return entry;
      })
      .finally(() => {
        inflight.delete(normalized);
      });
    inflight.set(normalized, pending);
  }
  const entry = await pending;
  if (options.signal?.aborted) throw abortError();
  return entry;
}

export function resetZoteroSearchCache(): void {
  cache.clear();
  inflight.clear();
}
