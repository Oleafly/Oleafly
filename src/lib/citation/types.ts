/** A search result from Crossref (or a fetched entry rendered as a hit). */
export interface CitationHit {
  doi: string | null;
  title: string;
  authors: string[];
  year: string | null;
  venue: string | null;
  type: string | null;
}

/** A parsed BibTeX entry. */
export interface ParsedBib {
  type: string;
  key: string;
  fields: Record<string, string>;
}
