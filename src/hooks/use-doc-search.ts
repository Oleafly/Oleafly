import { useEffect, useState } from "react";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { searchDocs, type SearchHit } from "@/lib/tauri";

export const DOC_SEARCH_DELAY_MS = 200;

export interface DocSearchOptions {
  readonly enabled?: boolean;
  readonly projectId?: string | null;
  readonly delayMs?: number;
}

export interface DocSearch {
  readonly term: string;
  readonly hits: SearchHit[];
  readonly loading: boolean;
}

interface DocSearchResult {
  readonly term: string;
  readonly projectId: string | null;
  readonly hits: SearchHit[];
}

const NO_RESULT: DocSearchResult = { term: "", projectId: null, hits: [] };

const isEmpty = (term: string) => term === "";

export function useDocSearch(
  query: string,
  { enabled = true, projectId = null, delayMs = DOC_SEARCH_DELAY_MS }: DocSearchOptions = {},
): DocSearch {
  const term = enabled ? query.trim() : "";
  const settled = useDebouncedValue(term, delayMs, isEmpty);
  const [result, setResult] = useState<DocSearchResult>(NO_RESULT);

  useEffect(() => {
    if (!settled) {
      setResult(NO_RESULT);
      return;
    }
    let cancelled = false;
    void searchDocs(settled)
      .catch((): SearchHit[] => [])
      .then((all) => {
        if (cancelled) return;
        setResult({
          term: settled,
          projectId,
          hits: projectId ? all.filter((hit) => hit.project_id === projectId) : all,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [settled, projectId]);

  if (!term) return { term, hits: [], loading: false };
  const loading = settled !== term || result.term !== term || result.projectId !== projectId;
  return { term, hits: result.hits, loading };
}
