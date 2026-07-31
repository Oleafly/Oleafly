import type { LiteratureRecord } from "@/lib/literature-search";

export interface BibliographyIdentities {
  dois: Set<string>;
  arxivIds: Set<string>;
  titles: Set<string>;
}

/** Lowercase alphanumeric only; first 60 chars for fuzzy title match. */
export function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 60);
}

function normalizeDoiKey(doi: string): string {
  return doi
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();
}

/** Strip trailing arXiv version suffix (e.g. v2). */
function normalizeArxivId(id: string): string {
  return id.trim().replace(/v\d+$/i, "");
}

function extractArxivFromUrl(url: string): string | null {
  const match = url.match(/arxiv\.org\/abs\/([^\s"'<>?#]+)/i);
  if (!match) return null;
  return normalizeArxivId(match[1]);
}

/**
 * Parse DOI, arXiv, and title identities from BibTeX (or similar) text.
 * Uses lightweight field regexes in the spirit of the OpenLeaf content script.
 */
export function parseBibliographyIdentities(bibText: string): BibliographyIdentities {
  const dois = new Set<string>();
  const arxivIds = new Set<string>();
  const titles = new Set<string>();

  const fieldRe =
    /\b(doi|eprint|title|url|note)\s*=\s*(?:\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}|"([^"]*)")/gi;

  let match: RegExpExecArray | null;
  while ((match = fieldRe.exec(bibText)) !== null) {
    const key = match[1].toLowerCase();
    const value = (match[2] ?? match[3] ?? "").trim();
    if (!value) continue;

    if (key === "doi") {
      const doi = normalizeDoiKey(value);
      if (doi.startsWith("10.")) dois.add(doi);
      continue;
    }

    if (key === "eprint") {
      arxivIds.add(normalizeArxivId(value));
      continue;
    }

    if (key === "title") {
      const titleKey = normalizeTitleKey(value);
      if (titleKey) titles.add(titleKey);
      continue;
    }

    // url / note may embed arXiv abs links
    const arxiv = extractArxivFromUrl(value);
    if (arxiv) arxivIds.add(arxiv);
  }

  // Also catch bare arxiv.org/abs links anywhere in the bib text
  const absRe = /arxiv\.org\/abs\/([^\s"'<>?#]+)/gi;
  while ((match = absRe.exec(bibText)) !== null) {
    arxivIds.add(normalizeArxivId(match[1]));
  }

  return { dois, arxivIds, titles };
}

function recordArxivId(record: LiteratureRecord): string | null {
  if (record.sourceIds.arxiv) {
    return normalizeArxivId(record.sourceIds.arxiv);
  }
  if (record.url) {
    return extractArxivFromUrl(record.url);
  }
  if (record.pdfUrl) {
    return extractArxivFromUrl(record.pdfUrl);
  }
  return null;
}

export function isRecordInBibliography(
  record: LiteratureRecord,
  ids: BibliographyIdentities,
): boolean {
  if (record.doi) {
    const doi = normalizeDoiKey(record.doi);
    if (doi && ids.dois.has(doi)) return true;
  }

  const arxiv = recordArxivId(record);
  if (arxiv && ids.arxivIds.has(arxiv)) return true;

  const titleKey = normalizeTitleKey(record.title);
  if (titleKey && ids.titles.has(titleKey)) return true;

  return false;
}

export function filterNewLiteratureRecords(
  records: LiteratureRecord[],
  ids: BibliographyIdentities,
): LiteratureRecord[] {
  return records.filter((record) => !isRecordInBibliography(record, ids));
}
