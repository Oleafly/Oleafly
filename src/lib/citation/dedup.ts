import { parseEntry } from "./bibtex";

/** The key of an existing `.bib` entry with this DOI, or null (dedup on add). */
export function findKeyByDoi(bibContent: string, doi: string): string | null {
  const norm = doi.trim().toLowerCase();
  if (!norm) return null;
  for (const chunk of bibContent.split(/(?=@\w+\s*\{)/)) {
    const p = parseEntry(chunk.trim());
    if (p && (p.fields.doi ?? "").trim().toLowerCase() === norm) return p.key;
  }
  return null;
}
