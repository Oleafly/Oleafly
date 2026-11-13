import type { ZoteroHit } from "@oleafly/backend-port";
import { useMemo } from "react";
import { existingKeyForHit, projectBibliography } from "@/features/zotero-cite";
import { hitDetail } from "@/lib/zotero/format";
import { useZoteroLibraryStore } from "@/store/zotero-library";
import { useZoteroSearch } from "./use-zotero-search";

export function useFreshZoteroHits(
  query: string,
  listed: readonly string[],
  limit: number,
): { hits: readonly ZoteroHit[]; pending: boolean } {
  const { hits, pending } = useZoteroSearch(query, limit);
  const fresh = useMemo(() => {
    if (hits.length === 0) return hits;
    const project = projectBibliography();
    const known = new Set(listed);
    return hits.filter((hit) => !known.has(hit.citationKey) && !project.keys.has(hit.citationKey) && !existingKeyForHit(hit, project));
  }, [hits, listed]);
  return { hits: fresh, pending };
}

export function ZoteroHitRow({ hit }: Readonly<{ hit: ZoteroHit }>) {
  const status = useZoteroLibraryStore((state) => state.status);
  return (
    <span
      className="grid min-w-0 max-w-80 flex-1 gap-y-0.5 py-0.5"
      style={{ contentVisibility: "auto", containIntrinsicSize: "36px" }}
    >
      <span className="truncate font-mono text-xs">{hit.citationKey}</span>
      <span className="truncate text-[0.625rem] text-muted-foreground">{hitDetail(hit, status)}</span>
    </span>
  );
}
