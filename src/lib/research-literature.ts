import { invoke } from "@tauri-apps/api/core";

/** The verdict of a citation check (Rust `oleafly_research::citation::CitationCheck`). */
export interface CitationCheck {
  verified: boolean;
  source: "doi" | "crossref-search";
  doi: string | null;
  matchedTitle: string | null;
  score: number | null;
  bibtex: string | null;
  reason: string | null;
}

/** Checks a reference by DOI (and title) or by title alone. */
export const verifyCitation = (input: { doi?: string; title?: string }) =>
  invoke<CitationCheck>("verify_citation", { doi: input.doi ?? null, title: input.title ?? null });
