import type { DocumentScanResult } from "./document-scan";
import type { DocumentCitationSettings } from "./settings";

const CACHE_KEY = "oleafly.document-citation.scan-cache.v1";
const MAX_ENTRIES = 12;
const TTL_MS = 24 * 60 * 60 * 1000;

export interface DocumentScanCacheEntry {
  cacheKey: string;
  result: DocumentScanResult;
  savedAt: number;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readAll(): DocumentScanCacheEntry[] {
  const target = storage();
  if (!target) return [];
  try {
    const raw = target.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DocumentScanCacheEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(entries: DocumentScanCacheEntry[]) {
  const target = storage();
  if (!target) return;
  try {
    target.setItem(CACHE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // Quota / private mode: ignore.
  }
}

/** Stable key for a scan (source + bib + settings that affect ranking). */
export function documentScanCacheKey(args: {
  sourceText: string;
  bibText: string;
  settings: DocumentCitationSettings;
  rankMode: "llm" | "heuristic";
}): string {
  return JSON.stringify({
    source: args.sourceText.trim().slice(0, 8000),
    bib: args.bibText.trim().slice(0, 4000),
    threshold: args.settings.scoreThreshold,
    perSource: args.settings.maxResultsPerSource,
    perParagraph: args.settings.maxResultsPerParagraph,
    maxParagraphs: args.settings.maxParagraphs,
    rankMode: args.rankMode,
  });
}

export function loadDocumentScanCache(
  cacheKey: string,
): DocumentScanResult | null {
  const now = Date.now();
  const entry = readAll().find(
    (item) =>
      item.cacheKey === cacheKey && now - item.savedAt <= TTL_MS,
  );
  return entry?.result ?? null;
}

export function saveDocumentScanCache(
  cacheKey: string,
  result: DocumentScanResult,
): void {
  const next: DocumentScanCacheEntry = {
    cacheKey,
    result,
    savedAt: Date.now(),
  };
  writeAll([
    next,
    ...readAll().filter((item) => item.cacheKey !== cacheKey),
  ]);
}

export function clearDocumentScanCache(): void {
  const target = storage();
  if (!target) return;
  try {
    target.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}
