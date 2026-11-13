import { useEffect, useState } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { describeError } from "@/lib/app-error";
import type { SearchMode } from "@/lib/search-modes";
import { textSearch, type TextSearchHit } from "@/lib/tauri";
import { textSearchQuery } from "@/lib/text-search-query";

export const DOC_SEARCH_DELAY_MS = 200;

export interface DocSearchOptions {
  readonly enabled?: boolean;
  readonly projectId?: string | null;
  readonly delayMs?: number;
  readonly mode?: SearchMode;
}

export interface SearchResults<T> {
  readonly term: string;
  readonly hits: T[];
  readonly loading: boolean;
  readonly error: string | null;
}

export type DocSearch = SearchResults<TextSearchHit>;

interface Settled<T> {
  readonly key: string;
  readonly hits: T[];
  readonly error: string | null;
}

const isEmpty = (term: string) => term === "";

export function useSearchResults<T>(
  query: string,
  scope: string,
  run: (term: string) => Promise<T[]> | null,
  delayMs: number = DOC_SEARCH_DELAY_MS,
): SearchResults<T> {
  const term = query.trim();
  const settled = useDebouncedValue(term, delayMs, isEmpty);
  const [result, setResult] = useState<Settled<T> | null>(null);
  const key = `${scope}\u0000${settled}`;
  const [runner] = useState(() => ({ run }));
  runner.run = run;

  useEffect(() => {
    const pending = settled ? runner.run(settled) : null;
    if (!pending) {
      setResult({ key, hits: [], error: null });
      return;
    }
    let cancelled = false;
    void pending.then(
      (hits) => {
        if (!cancelled) setResult({ key, hits, error: null });
      },
      (error: unknown) => {
        if (!cancelled) setResult({ key, hits: [], error: describeError(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, runner, settled]);

  if (!term) return { term, hits: [], loading: false, error: null };
  const current = result?.key === key ? result : null;
  return { term, hits: current?.hits ?? [], loading: settled !== term || current === null, error: current?.error ?? null };
}

export function useDocSearch(
  query: string,
  { enabled = true, projectId = null, delayMs = DOC_SEARCH_DELAY_MS, mode = "ranked" }: DocSearchOptions = {},
): DocSearch {
  return useSearchResults(
    enabled ? query : "",
    `${mode}\u0000${projectId ?? ""}`,
    (term) => {
      const request = textSearchQuery(term, mode, projectId === null);
      return request ? textSearch(projectId, request) : null;
    },
    delayMs,
  );
}
