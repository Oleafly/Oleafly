import { useDeferredValue, useEffect, useState } from "react";
import type { ZoteroHit } from "@oleafly/backend-port";
import { logError } from "@/lib/log";
import { zoteroSearchable } from "@/lib/zotero/hint";
import { cachedZoteroSearch, searchZoteroLibrary } from "@/lib/zotero/search-client";
import { useZoteroLibraryStore } from "@/store/zotero-library";

const EMPTY: readonly ZoteroHit[] = [];

export function useZoteroSearch(query: string, limit: number): { hits: readonly ZoteroHit[]; pending: boolean } {
  const deferred = useDeferredValue(query.trim());
  const generation = useZoteroLibraryStore((state) => state.status?.generation ?? -1);
  const searchable = useZoteroLibraryStore((state) => zoteroSearchable(state.status));
  const [result, setResult] = useState<{ query: string; generation: number; hits: readonly ZoteroHit[] }>({
    query: "",
    generation: -1,
    hits: EMPTY,
  });

  useEffect(() => {
    if (!searchable || !deferred) return;
    const cached = cachedZoteroSearch(deferred, generation);
    if (cached) {
      setResult({ query: deferred, generation, hits: cached.hits.slice(0, limit) });
      return;
    }
    const controller = new AbortController();
    searchZoteroLibrary(deferred, { generation, signal: controller.signal })
      .then((entry) => {
        if (!controller.signal.aborted) setResult({ query: deferred, generation, hits: entry.hits.slice(0, limit) });
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        void logError("search the Zotero library", error);
      });
    return () => controller.abort();
  }, [deferred, generation, limit, searchable]);

  if (!searchable || !deferred) return { hits: EMPTY, pending: false };
  return { hits: result.hits, pending: result.query !== deferred || result.generation !== generation };
}
