import type { CitationHit } from "./types";

/** Parse a Crossref `/works` JSON response into citation hits. */
export function parseCrossrefSearch(json: string): CitationHit[] {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const items: any[] = data?.message?.items ?? [];
  return items.map((it) => ({
    doi: it.DOI ?? null,
    title: Array.isArray(it.title) ? it.title[0] ?? "" : it.title ?? "",
    authors: (it.author ?? [])
      .map((a: any) => (a.family ? `${a.family}${a.given ? `, ${a.given}` : ""}` : a.name ?? ""))
      .filter(Boolean),
    year: it.issued?.["date-parts"]?.[0]?.[0]?.toString() ?? null,
    venue: Array.isArray(it["container-title"]) ? it["container-title"][0] ?? null : it["container-title"] ?? null,
    type: it.type ?? null,
  }));
}
