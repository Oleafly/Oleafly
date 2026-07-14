export interface CitationHit {
  doi: string | null;
  title: string;
  authors: string[];
  year: string | null;
  venue: string | null;
  type: string | null;
}

export interface ParsedBib {
  type: string;
  key: string;
  fields: Record<string, string>;
}
