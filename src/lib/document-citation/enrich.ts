import type { LiteratureRecord } from "@/lib/literature-search";
import { literatureArxivLookup } from "@/lib/tauri";

// Google Scholar results via Serper carry no author metadata, so their
// BibTeX and ranking prompts would ship half-empty. Backfill from Semantic
// Scholar's single-paper arXiv lookup, mirroring OpenLeaf's enrichment step.

const MAX_LOOKUPS_PER_CALL = 8;

interface ArxivLookupDetails {
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
}

export type ArxivLookupFn = (
  arxivId: string,
) => Promise<ArxivLookupDetails | null>;

const lookupCache = new Map<string, ArxivLookupDetails | null>();

/** Test seam. */
export function clearArxivLookupCache(): void {
  lookupCache.clear();
}

function parseLookupResponse(raw: string): ArxivLookupDetails | null {
  try {
    const value = JSON.parse(raw) as {
      title?: unknown;
      authors?: Array<{ name?: unknown }>;
      year?: unknown;
      venue?: unknown;
      externalIds?: { DOI?: unknown };
    };
    const authors = (value.authors ?? [])
      .map((author) =>
        typeof author?.name === "string" ? author.name.trim() : "",
      )
      .filter(Boolean);
    return {
      authors,
      year: typeof value.year === "number" ? value.year : null,
      venue: typeof value.venue === "string" && value.venue ? value.venue : null,
      doi:
        typeof value.externalIds?.DOI === "string"
          ? value.externalIds.DOI
          : null,
    };
  } catch {
    return null;
  }
}

async function defaultLookup(
  arxivId: string,
): Promise<ArxivLookupDetails | null> {
  try {
    return parseLookupResponse(await literatureArxivLookup(arxivId));
  } catch {
    return null;
  }
}

function arxivIdOf(record: LiteratureRecord): string | null {
  return record.sourceIds.arxiv ?? null;
}

/**
 * Fill authors (and missing year/venue/doi) for author-less records that
 * carry an arXiv id. Failed or unknown lookups leave records unchanged;
 * results are cached for the session.
 */
export async function enrichAuthorlessRecords(
  records: LiteratureRecord[],
  lookup: ArxivLookupFn = defaultLookup,
): Promise<LiteratureRecord[]> {
  const pending = records
    .map((record, index) => ({ record, index }))
    .filter(
      ({ record }) =>
        record.authors.length === 0 && arxivIdOf(record) !== null,
    )
    .slice(0, MAX_LOOKUPS_PER_CALL);
  if (!pending.length) return records;

  const enriched = [...records];
  await Promise.all(
    pending.map(async ({ record, index }) => {
      const id = arxivIdOf(record);
      if (!id) return;
      if (!lookupCache.has(id)) {
        lookupCache.set(id, await lookup(id));
      }
      const details = lookupCache.get(id);
      if (!details || details.authors.length === 0) return;
      enriched[index] = {
        ...record,
        authors: details.authors,
        year: record.year ?? details.year,
        venue: record.venue ?? details.venue,
        doi: record.doi ?? details.doi,
      };
    }),
  );
  return enriched;
}
