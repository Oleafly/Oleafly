import type { CitationHit } from "./types";

interface CrossrefAuthor {
  family?: string;
  given?: string;
  name?: string;
}

interface CrossrefItem {
  DOI?: string;
  title?: string | string[];
  author?: CrossrefAuthor[];
  issued?: { "date-parts"?: Array<Array<number | string>> };
  "container-title"?: string | string[];
  type?: string;
}

interface CrossrefResponse {
  message?: { items?: CrossrefItem[] };
}

export function parseCrossrefSearch(json: string): CitationHit[] {
  let data: CrossrefResponse;
  try {
    data = JSON.parse(json) as CrossrefResponse;
  } catch {
    return [];
  }
  const items = data.message?.items ?? [];
  return items.map((it) => ({
    doi: it.DOI ?? null,
    title: Array.isArray(it.title) ? it.title[0] ?? "" : it.title ?? "",
    authors: (it.author ?? [])
      .map((a) => (a.family ? `${a.family}${a.given ? `, ${a.given}` : ""}` : a.name ?? ""))
      .filter(Boolean),
    year: it.issued?.["date-parts"]?.[0]?.[0]?.toString() ?? null,
    venue: Array.isArray(it["container-title"]) ? it["container-title"][0] ?? null : it["container-title"] ?? null,
    type: it.type ?? null,
  }));
}
