import { literatureSearch as invokeLiteratureSearch } from "@/lib/tauri";
import {
  cleanField,
  decodeXmlEntities,
  stripTags,
  toBibName,
} from "@/lib/citation/text";
import {
  generateCiteKey,
  stringifyBibEntry,
} from "@/lib/citation/bibtex";

export type LiteratureSource =
  | "arxiv"
  | "semantic-scholar"
  | "crossref"
  | "pubmed"
  | "openalex"
  | "uspto";

export interface LiteratureSourceDefinition {
  id: LiteratureSource;
  label: string;
  shortLabel: string;
  available: boolean;
  description: string;
}

export const LITERATURE_SOURCES: LiteratureSourceDefinition[] = [
  {
    id: "arxiv",
    label: "arXiv",
    shortLabel: "arXiv",
    available: true,
    description:
      "More than 2.4 million preprints in physics, mathematics, computer science, quantitative biology, and related fields.",
  },
  {
    id: "semantic-scholar",
    label: "Semantic Scholar",
    shortLabel: "S2",
    available: true,
    description:
      "A scholarly index with citation graphs, influential citation data, and TLDR summaries.",
  },
  {
    id: "crossref",
    label: "Crossref",
    shortLabel: "Crossref",
    available: true,
    description:
      "The DOI registry with metadata for more than 150 million research outputs.",
  },
  {
    id: "pubmed",
    label: "PubMed",
    shortLabel: "PubMed",
    available: true,
    description:
      "More than 40 million citations and abstracts from biomedical and life sciences literature, including MEDLINE.",
  },
  {
    id: "openalex",
    label: "OpenAlex",
    shortLabel: "OpenAlex",
    available: true,
    description:
      "An open catalog of scholarly works, authors, sources, institutions, topics, publishers, and funders.",
  },
  {
    id: "uspto",
    label: "USPTO",
    shortLabel: "USPTO",
    available: false,
    description:
      "US patent grants and published applications for prior art and applied research. Search is paused during the PatentsView migration.",
  },
];

export const DEFAULT_LITERATURE_SOURCES: LiteratureSource[] = LITERATURE_SOURCES
  .filter((source) => source.available)
  .map((source) => source.id);

export interface LiteratureRecord {
  id: string;
  sourceIds: Partial<Record<LiteratureSource, string>>;
  sources: LiteratureSource[];
  title: string;
  authors: string[];
  year: number | null;
  publicationDate: string | null;
  venue: string | null;
  type: string | null;
  doi: string | null;
  url: string | null;
  pdfUrl: string | null;
  abstract: string | null;
  citationCount: number | null;
  openAccess: boolean | null;
}

export interface LiteratureSearchOptions {
  query: string;
  sources: LiteratureSource[];
  limit?: number;
  yearFrom?: number | null;
  yearTo?: number | null;
  openAccessOnly?: boolean;
  ignoreCache?: boolean;
}

export interface LiteratureSourceRun {
  source: LiteratureSource;
  status: "ok" | "error";
  count: number;
  total: number | null;
  durationMs: number;
  error?: string;
}

export interface LiteratureSearchResponse {
  results: LiteratureRecord[];
  runs: LiteratureSourceRun[];
  searchedAt: number;
  cached: boolean;
}

interface ParsedSource {
  records: LiteratureRecord[];
  total: number | null;
}

type SearchTransport = (
  source: string,
  query: string,
  options: {
    limit?: number;
    yearFrom?: number | null;
    yearTo?: number | null;
    openAccessOnly?: boolean;
  },
) => Promise<string>;

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = stripTags(decodeXmlEntities(value))
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || null;
}

function normalizeDoi(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const doi = value
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "");
  return doi.startsWith("10.") ? doi : null;
}

function safeUrl(value: unknown): string | null {
  const candidate = text(value);
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function yearFrom(value: unknown): number | null {
  const match = String(value ?? "").match(/\b(18|19|20|21)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sourceRecord(
  source: LiteratureSource,
  sourceId: string,
  record: Omit<LiteratureRecord, "id" | "sourceIds" | "sources">,
): LiteratureRecord {
  return {
    ...record,
    id: `${source}:${sourceId}`,
    sourceIds: { [source]: sourceId },
    sources: [source],
  };
}

interface CrossrefResponse {
  message?: {
    "total-results"?: number;
    items?: Array<{
      DOI?: string;
      title?: string | string[];
      author?: Array<{ given?: string; family?: string; name?: string }>;
      issued?: { "date-parts"?: Array<Array<number | string>> };
      "container-title"?: string | string[];
      type?: string;
      URL?: string;
      "is-referenced-by-count"?: number;
      abstract?: string;
    }>;
  };
}

export function parseCrossrefLiterature(raw: string): ParsedSource {
  const response = parseJson<CrossrefResponse>(raw);
  const items = response?.message?.items ?? [];
  const records = items.flatMap((item, index) => {
    const titleValue = Array.isArray(item.title) ? item.title[0] : item.title;
    const title = text(titleValue);
    if (!title) return [];
    const doi = normalizeDoi(item.DOI);
    const sourceId = doi ?? `result-${index}`;
    const venueValue = Array.isArray(item["container-title"])
      ? item["container-title"][0]
      : item["container-title"];
    const authors = (item.author ?? [])
      .map((author) => {
        if (author.name) return text(author.name);
        return text([author.given, author.family].filter(Boolean).join(" "));
      })
      .filter((author): author is string => Boolean(author));
    return [
      sourceRecord("crossref", sourceId, {
        title,
        authors,
        year: yearFrom(item.issued?.["date-parts"]?.[0]?.[0]),
        publicationDate: null,
        venue: text(venueValue),
        type: text(item.type),
        doi,
        url: doi ? `https://doi.org/${doi}` : safeUrl(item.URL),
        pdfUrl: null,
        abstract: text(item.abstract),
        citationCount: finiteNumber(item["is-referenced-by-count"]),
        openAccess: null,
      }),
    ];
  });
  return {
    records,
    total: finiteNumber(response?.message?.["total-results"]),
  };
}

interface OpenAlexResponse {
  meta?: { count?: number };
  results?: Array<{
    id?: string;
    doi?: string;
    title?: string;
    publication_year?: number;
    publication_date?: string;
    type?: string;
    authorships?: Array<{ author?: { id?: string; display_name?: string } }>;
    primary_location?: {
      landing_page_url?: string;
      pdf_url?: string;
      source?: { display_name?: string };
    };
    cited_by_count?: number;
    open_access?: { is_oa?: boolean; oa_url?: string };
    best_oa_location?: { landing_page_url?: string; pdf_url?: string };
  }>;
}

export function parseOpenAlexLiterature(raw: string): ParsedSource {
  const response = parseJson<OpenAlexResponse>(raw);
  const records = (response?.results ?? []).flatMap((item, index) => {
    const title = text(item.title);
    if (!title) return [];
    const sourceId = text(item.id)?.split("/").pop() ?? `result-${index}`;
    const doi = normalizeDoi(item.doi);
    const authors = (item.authorships ?? [])
      .map((authorship) => text(authorship.author?.display_name))
      .filter((author): author is string => Boolean(author));
    const landingPage =
      safeUrl(item.best_oa_location?.landing_page_url) ??
      safeUrl(item.primary_location?.landing_page_url);
    return [
      sourceRecord("openalex", sourceId, {
        title,
        authors,
        year: yearFrom(item.publication_year),
        publicationDate: text(item.publication_date),
        venue: text(item.primary_location?.source?.display_name),
        type: text(item.type),
        doi,
        url: doi ? `https://doi.org/${doi}` : landingPage ?? safeUrl(item.id),
        pdfUrl:
          safeUrl(item.best_oa_location?.pdf_url) ??
          safeUrl(item.primary_location?.pdf_url),
        abstract: null,
        citationCount: finiteNumber(item.cited_by_count),
        openAccess:
          typeof item.open_access?.is_oa === "boolean"
            ? item.open_access.is_oa
            : null,
      }),
    ];
  });
  return { records, total: finiteNumber(response?.meta?.count) };
}

interface SemanticScholarResponse {
  total?: number;
  data?: Array<{
    paperId?: string;
    title?: string;
    authors?: Array<{ name?: string }>;
    year?: number;
    venue?: string;
    publicationDate?: string;
    externalIds?: { DOI?: string; ArXiv?: string; PubMed?: string };
    url?: string;
    openAccessPdf?: { url?: string } | null;
    citationCount?: number;
    publicationTypes?: string[];
    abstract?: string;
  }>;
}

export function parseSemanticScholarLiterature(raw: string): ParsedSource {
  const response = parseJson<SemanticScholarResponse>(raw);
  const records = (response?.data ?? []).flatMap((item, index) => {
    const title = text(item.title);
    if (!title) return [];
    const sourceId = text(item.paperId) ?? `result-${index}`;
    const doi = normalizeDoi(item.externalIds?.DOI);
    const authors = (item.authors ?? [])
      .map((author) => text(author.name))
      .filter((author): author is string => Boolean(author));
    const pdfUrl = safeUrl(item.openAccessPdf?.url);
    return [
      sourceRecord("semantic-scholar", sourceId, {
        title,
        authors,
        year: yearFrom(item.year),
        publicationDate: text(item.publicationDate),
        venue: text(item.venue),
        type: text(item.publicationTypes?.[0]),
        doi,
        url: doi ? `https://doi.org/${doi}` : safeUrl(item.url),
        pdfUrl,
        abstract: text(item.abstract),
        citationCount: finiteNumber(item.citationCount),
        openAccess: pdfUrl ? true : null,
      }),
    ];
  });
  return { records, total: finiteNumber(response?.total) };
}

interface PubMedResponse {
  total?: string | number;
  summary?: {
    result?: Record<
      string,
      | string[]
      | {
          uid?: string;
          pubdate?: string;
          epubdate?: string;
          source?: string;
          authors?: Array<{ name?: string }>;
          title?: string;
          pubtype?: string[];
          articleids?: Array<{ idtype?: string; value?: string }>;
        }
    >;
  };
}

export function parsePubMedLiterature(raw: string): ParsedSource {
  const response = parseJson<PubMedResponse>(raw);
  const result = response?.summary?.result ?? {};
  const uids = Array.isArray(result.uids) ? result.uids : [];
  const records = uids.flatMap((uid) => {
    if (typeof uid !== "string") return [];
    const item = result[uid];
    if (!item || Array.isArray(item)) return [];
    const title = text(item.title);
    if (!title) return [];
    const ids = item.articleids ?? [];
    const doi = normalizeDoi(
      ids.find((identifier) => identifier.idtype === "doi")?.value,
    );
    const pmc = text(
      ids.find((identifier) => identifier.idtype === "pmc")?.value,
    );
    const authors = (item.authors ?? [])
      .map((author) => text(author.name))
      .filter((author): author is string => Boolean(author));
    return [
      sourceRecord("pubmed", uid, {
        title,
        authors,
        year: yearFrom(item.pubdate ?? item.epubdate),
        publicationDate: text(item.epubdate ?? item.pubdate),
        venue: text(item.source),
        type: text(item.pubtype?.[0]),
        doi,
        url: `https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
        pdfUrl: null,
        abstract: null,
        citationCount: null,
        openAccess: pmc ? true : null,
      }),
    ];
  });
  return { records, total: finiteNumber(response?.total) };
}

function xmlTag(block: string, tag: string): string | null {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text(
    new RegExp(
      `<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`,
      "i",
    ).exec(block)?.[1],
  );
}

function xmlAttribute(tag: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "i",
  ).exec(tag);
  return text(match?.[1] ?? match?.[2]);
}

export function parseArxivLiterature(raw: string): ParsedSource {
  const entries = [...raw.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map(
    (match) => match[0],
  );
  const records = entries.flatMap((entry, index) => {
    const title = xmlTag(entry, "title");
    if (!title) return [];
    const entryUrl = safeUrl(xmlTag(entry, "id"));
    const sourceId =
      entryUrl
        ?.replace(/^https?:\/\/arxiv\.org\/abs\//i, "")
        .replace(/v\d+$/i, "") ?? `result-${index}`;
    const authors = [...entry.matchAll(/<author\b[\s\S]*?<\/author>/gi)]
      .map((author) => xmlTag(author[0], "name"))
      .filter((author): author is string => Boolean(author));
    const links = [...entry.matchAll(/<link\b[^>]*\/?>/gi)].map(
      (match) => match[0],
    );
    const pdfLink = links.find(
      (link) =>
        xmlAttribute(link, "title")?.toLowerCase() === "pdf" ||
        xmlAttribute(link, "type")?.toLowerCase() === "application/pdf",
    );
    const doi = normalizeDoi(xmlTag(entry, "arxiv:doi"));
    const published = xmlTag(entry, "published");
    return [
      sourceRecord("arxiv", sourceId, {
        title,
        authors,
        year: yearFrom(published),
        publicationDate: published,
        venue: xmlTag(entry, "arxiv:journal_ref") ?? "arXiv",
        type: "preprint",
        doi,
        url: entryUrl,
        pdfUrl:
          (pdfLink ? safeUrl(xmlAttribute(pdfLink, "href")) : null) ??
          (entryUrl ? entryUrl.replace("/abs/", "/pdf/") : null),
        abstract: xmlTag(entry, "summary"),
        citationCount: null,
        openAccess: true,
      }),
    ];
  });
  return {
    records,
    total: finiteNumber(xmlTag(raw, "opensearch:totalResults")),
  };
}

const PARSERS: Record<
  Exclude<LiteratureSource, "uspto">,
  (raw: string) => ParsedSource
> = {
  arxiv: parseArxivLiterature,
  "semantic-scholar": parseSemanticScholarLiterature,
  crossref: parseCrossrefLiterature,
  pubmed: parsePubMedLiterature,
  openalex: parseOpenAlexLiterature,
};

function titleIdentity(title: string): string {
  return title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function literatureIdentity(record: LiteratureRecord): string {
  return record.doi
    ? `doi:${record.doi.toLowerCase()}`
    : `title:${titleIdentity(record.title)}`;
}

function richerText(
  first: string | null,
  second: string | null,
): string | null {
  if (!first) return second;
  if (!second) return first;
  return second.length > first.length ? second : first;
}

function mergeRecord(
  first: LiteratureRecord,
  second: LiteratureRecord,
): LiteratureRecord {
  const sources = [...new Set([...first.sources, ...second.sources])];
  const citationCounts = [first.citationCount, second.citationCount].filter(
    (count): count is number => count != null,
  );
  return {
    ...first,
    sourceIds: { ...first.sourceIds, ...second.sourceIds },
    sources,
    title: richerText(first.title, second.title) ?? first.title,
    authors:
      second.authors.length > first.authors.length
        ? second.authors
        : first.authors,
    year: first.year ?? second.year,
    publicationDate: first.publicationDate ?? second.publicationDate,
    venue: richerText(first.venue, second.venue),
    type: first.type ?? second.type,
    doi: first.doi ?? second.doi,
    url: first.url ?? second.url,
    pdfUrl: first.pdfUrl ?? second.pdfUrl,
    abstract: richerText(first.abstract, second.abstract),
    citationCount: citationCounts.length
      ? Math.max(...citationCounts)
      : null,
    openAccess:
      first.openAccess === true || second.openAccess === true
        ? true
        : first.openAccess ?? second.openAccess,
  };
}

export function mergeLiteratureRecords(
  groups: LiteratureRecord[][],
): LiteratureRecord[] {
  const merged: LiteratureRecord[] = [];
  const indexByIdentity = new Map<string, number>();
  const longestGroup = Math.max(0, ...groups.map((group) => group.length));

  // Round-robin preserves each index's relevance ordering while avoiding a
  // first-source bias in the combined result list.
  for (let rank = 0; rank < longestGroup; rank++) {
    for (const group of groups) {
      const record = group[rank];
      if (!record) continue;
      const identity = literatureIdentity(record);
      const existingIndex = indexByIdentity.get(identity);
      if (existingIndex == null) {
        indexByIdentity.set(identity, merged.length);
        merged.push(record);
      } else {
        merged[existingIndex] = mergeRecord(merged[existingIndex], record);
      }
    }
  }
  return merged;
}

function bibtexType(record: LiteratureRecord): string {
  const type = record.type?.toLowerCase() ?? "";
  if (type.includes("proceedings") || type.includes("conference")) {
    return "inproceedings";
  }
  if (type.includes("book")) return "book";
  if (type.includes("thesis")) return "phdthesis";
  if (
    type.includes("article") ||
    (record.venue && record.venue !== "arXiv" && !type.includes("preprint"))
  ) {
    return "article";
  }
  return "misc";
}

export function bibtexForLiteratureRecord(record: LiteratureRecord): string {
  const type = bibtexType(record);
  const author = record.authors
    .map((name) => toBibName(name))
    .join(" and ");
  const fields: Record<string, string> = {
    title: cleanField(record.title),
    author: cleanField(author),
    year: record.year ? String(record.year) : "",
  };
  if (record.venue) {
    fields[type === "inproceedings" ? "booktitle" : "journal"] = cleanField(
      record.venue,
    );
  }
  if (record.doi) fields.doi = cleanField(record.doi);
  if (record.url) fields.url = cleanField(record.url);
  if (record.sources.includes("arxiv")) {
    const arxivId = record.sourceIds.arxiv;
    if (arxivId) {
      fields.eprint = cleanField(arxivId);
      fields.archiveprefix = "arXiv";
    }
  }
  const key = generateCiteKey(fields, new Set());
  return stringifyBibEntry({ type, key, fields });
}

const CACHE_KEY = "oleafly.literature-search.cache.v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 20;

interface CacheEntry {
  key: string;
  response: LiteratureSearchResponse;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function cacheKey(options: LiteratureSearchOptions): string {
  return JSON.stringify({
    query: options.query.trim().toLowerCase(),
    sources: [...options.sources].sort(),
    limit: options.limit ?? 12,
    yearFrom: options.yearFrom ?? null,
    yearTo: options.yearTo ?? null,
    openAccessOnly: options.openAccessOnly ?? false,
  });
}

function readCache(): CacheEntry[] {
  try {
    const parsed = JSON.parse(storage()?.getItem(CACHE_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as CacheEntry[]) : [];
  } catch {
    return [];
  }
}

function cachedResponse(
  options: LiteratureSearchOptions,
): LiteratureSearchResponse | null {
  const now = Date.now();
  const entry = readCache().find(
    (candidate) =>
      candidate.key === cacheKey(options) &&
      now - candidate.response.searchedAt <= CACHE_TTL_MS,
  );
  return entry ? { ...entry.response, cached: true } : null;
}

function writeCache(
  options: LiteratureSearchOptions,
  response: LiteratureSearchResponse,
) {
  const target = storage();
  if (!target) return;
  try {
    const key = cacheKey(options);
    const next = [
      { key, response: { ...response, cached: false } },
      ...readCache().filter((entry) => entry.key !== key),
    ].slice(0, MAX_CACHE_ENTRIES);
    target.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    // Search still succeeds when private browsing or a storage quota blocks
    // the best-effort local cache.
  }
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function searchLiterature(
  options: LiteratureSearchOptions,
  transport: SearchTransport = invokeLiteratureSearch,
): Promise<LiteratureSearchResponse> {
  if (!options.ignoreCache) {
    const cached = cachedResponse(options);
    if (cached) return cached;
  }

  const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 12)), 25);
  const sourceResults = await Promise.all(
    options.sources.map(async (source) => {
      const started = performance.now();
      try {
        if (source === "uspto") {
          throw new Error(
            "USPTO has temporarily paused PatentsView search APIs during its Open Data Portal migration.",
          );
        }
        const raw = await transport(source, options.query, {
          limit,
          yearFrom: options.yearFrom,
          yearTo: options.yearTo,
          openAccessOnly: options.openAccessOnly,
        });
        const parsed = PARSERS[source](raw);
        const records = parsed.records.filter((record) => {
          if (
            options.yearFrom != null &&
            record.year != null &&
            record.year < options.yearFrom
          ) {
            return false;
          }
          if (
            options.yearTo != null &&
            record.year != null &&
            record.year > options.yearTo
          ) {
            return false;
          }
          return !options.openAccessOnly || record.openAccess === true;
        });
        return {
          records,
          run: {
            source,
            status: "ok" as const,
            count: records.length,
            total: parsed.total,
            durationMs: Math.round(performance.now() - started),
          },
        };
      } catch (error) {
        return {
          records: [] as LiteratureRecord[],
          run: {
            source,
            status: "error" as const,
            count: 0,
            total: null,
            durationMs: Math.round(performance.now() - started),
            error: errorMessage(error),
          },
        };
      }
    }),
  );

  const response: LiteratureSearchResponse = {
    results: mergeLiteratureRecords(
      sourceResults.map((sourceResult) => sourceResult.records),
    ),
    runs: sourceResults.map((sourceResult) => sourceResult.run),
    searchedAt: Date.now(),
    cached: false,
  };
  writeCache(options, response);
  return response;
}
