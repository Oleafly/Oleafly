import { plainText } from "@/lib/zotero/rich-text";
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

function firstText(value: string | string[] | undefined): string | null {
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === "string" ? plainText(text) : null;
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
    title: firstText(it.title) ?? "",
    authors: (it.author ?? [])
      .map((a) => {
        const given = a.given ? `, ${a.given}` : "";
        return a.family ? `${a.family}${given}` : a.name ?? "";
      })
      .filter(Boolean),
    year: it.issued?.["date-parts"]?.[0]?.[0]?.toString() ?? null,
    venue: firstText(it["container-title"]),
    type: it.type ?? null,
  }));
}
