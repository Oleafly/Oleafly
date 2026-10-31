import { invoke } from "@tauri-apps/api/core";

export interface CitationCheck {
  verified: boolean;
  source: "doi" | "crossref-search";
  doi: string | null;
  matchedTitle: string | null;
  score: number | null;
  bibtex: string | null;
  reason: string | null;
}

export const verifyCitation = (input: { doi?: string; title?: string }) =>
  invoke<CitationCheck>("verify_citation", { doi: input.doi ?? null, title: input.title ?? null });
