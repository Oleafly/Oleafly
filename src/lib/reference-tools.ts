import { Cite, plugins } from "@citation-js/core";
import "@citation-js/plugin-bibtex";
import "@citation-js/plugin-csl";
import acsStyle from "@/assets/csl/american-chemical-society.csl?raw";
import amaStyle from "@/assets/csl/american-medical-association.csl?raw";
import chicagoStyle from "@/assets/csl/chicago-author-date.csl?raw";
import ieeeStyle from "@/assets/csl/ieee.csl?raw";
import mlaStyle from "@/assets/csl/modern-language-association.csl?raw";
import { generateCiteKey, stringifyBibEntry } from "@/lib/citation/bibtex";
import { detectInput, type DetectedInput } from "@/lib/citation/detect";
import { parseBib, validateBib, type BibFinding } from "@/lib/latex-tools";
import { i18n } from "@/i18n";

export type ReferenceToolId =
  | "arxiv-citation-generator"
  | "bibliography-generator"
  | "citation-generator"
  | "citation-styles"
  | "doi-to-bibtex"
  | "isbn-to-bibtex"
  | "pubmed-to-bibtex"
  | "url-to-bibtex";

export type CitationStyleId =
  | "apa"
  | "mla"
  | "chicago"
  | "ieee"
  | "harvard"
  | "vancouver"
  | "ama"
  | "acs";

export interface CitationStyleDefinition {
  id: CitationStyleId;
  label: string;
  fullName: string;
  template: string;
}

export const CITATION_STYLES: readonly CitationStyleDefinition[] = [
  { id: "apa", label: "APA 7", fullName: "APA 7th edition", template: "apa" },
  { id: "mla", label: "MLA 9", fullName: "MLA 9th edition", template: "oleafly-mla" },
  {
    id: "chicago",
    label: "Chicago",
    fullName: "Chicago 17th edition, author-date",
    template: "oleafly-chicago-author-date",
  },
  { id: "ieee", label: "IEEE", fullName: "IEEE", template: "oleafly-ieee" },
  {
    id: "harvard",
    label: "Harvard",
    fullName: "Harvard, Cite Them Right",
    template: "harvard1",
  },
  { id: "vancouver", label: "Vancouver", fullName: "Vancouver / NLM", template: "vancouver" },
  { id: "ama", label: "AMA 11", fullName: "AMA 11th edition", template: "oleafly-ama" },
  { id: "acs", label: "ACS", fullName: "American Chemical Society", template: "oleafly-acs" },
] as const;

const EXTRA_STYLES: ReadonlyArray<readonly [string, string]> = [
  ["oleafly-mla", mlaStyle],
  ["oleafly-chicago-author-date", chicagoStyle],
  ["oleafly-ieee", ieeeStyle],
  ["oleafly-ama", amaStyle],
  ["oleafly-acs", acsStyle],
];

let stylesRegistered = false;
let cachedBibtex = "";
let cachedCite: Cite | null = null;
const cachedFormats = new Map<CitationStyleId, FormattedCitation>();
export const MAX_BIBTEX_CHARACTERS = 1_000_000;
export const MAX_BIBTEX_ENTRIES = 2_000;

function registerStyles(): void {
  if (stylesRegistered) return;
  const styles = plugins.config.get("@csl").styles;
  for (const [name, xml] of EXTRA_STYLES) {
    if (!styles.has(name)) styles.add(name, xml);
  }
  stylesRegistered = true;
}

function styleById(style: CitationStyleId): CitationStyleDefinition {
  const found = CITATION_STYLES.find((candidate) => candidate.id === style);
  if (!found) throw new Error(`Unknown citation style: ${style}`);
  return found;
}

function outputText(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error(i18n.t(($) => $.researchTools.referenceErrors.unreadableResult));
  }
  return value.replaceAll("\u00a0", " ").trim();
}

export interface FormattedCitation {
  bibliography: string;
  inText: string;
  entries: number;
}

function parsedCitation(bibtex: string): Cite {
  if (cachedCite && cachedBibtex === bibtex) return cachedCite;
  const cite = new Cite(bibtex);
  cachedBibtex = bibtex;
  cachedCite = cite;
  cachedFormats.clear();
  return cite;
}

export function formatCitations(
  bibtex: string,
  style: CitationStyleId,
): FormattedCitation {
  if (!bibtex.trim()) return { bibliography: "", inText: "", entries: 0 };
  if (bibtex.length > MAX_BIBTEX_CHARACTERS) {
    throw new Error(i18n.t(($) => $.researchTools.referenceErrors.bibliographyTooLarge));
  }
  registerStyles();
  const cached = cachedFormats.get(style);
  if (cachedBibtex === bibtex && cached) return { ...cached };
  const cite = parsedCitation(bibtex);
  if (cite.data.length === 0) {
    throw new Error(i18n.t(($) => $.researchTools.referenceErrors.noEntries));
  }
  if (cite.data.length > MAX_BIBTEX_ENTRIES) {
    throw new Error(i18n.t(($) => $.researchTools.referenceErrors.tooManyEntries, {
      max: MAX_BIBTEX_ENTRIES.toLocaleString(),
    }));
  }
  const template = styleById(style).template;
  const formatted = {
    bibliography: outputText(
      cite.format("bibliography", { format: "text", template, lang: "en-US" }),
    ),
    inText: outputText(
      cite.format("citation", { format: "text", template, lang: "en-US" }),
    ),
    entries: cite.data.length,
  };
  cachedFormats.set(style, formatted);
  return { ...formatted };
}

export function formatAllStyles(
  bibtex: string,
): Array<CitationStyleDefinition & FormattedCitation> {
  return CITATION_STYLES.map((style) => ({
    ...style,
    ...formatCitations(bibtex, style.id),
  }));
}

export type ReferenceEntryType = "article" | "book" | "incollection" | "inproceedings" | "misc";

export interface ReferenceFormData {
  type: ReferenceEntryType;
  title: string;
  authors: string;
  year: string;
  container: string;
  publisher: string;
  volume: string;
  issue: string;
  pages: string;
  doi: string;
  isbn: string;
  pmid: string;
  url: string;
}

export const EMPTY_REFERENCE: ReferenceFormData = {
  type: "article",
  title: "",
  authors: "",
  year: "",
  container: "",
  publisher: "",
  volume: "",
  issue: "",
  pages: "",
  doi: "",
  isbn: "",
  pmid: "",
  url: "",
};

export const EXAMPLE_REFERENCE: ReferenceFormData = {
  type: "article",
  title: "Attention Is All You Need",
  authors: "Ashish Vaswani; Noam Shazeer; Niki Parmar; Jakob Uszkoreit",
  year: "2017",
  container: "Advances in Neural Information Processing Systems",
  publisher: "",
  volume: "30",
  issue: "",
  pages: "5998--6008",
  doi: "",
  isbn: "",
  pmid: "",
  url: "https://arxiv.org/abs/1706.03762",
};

function normalizedAuthors(authors: string): string {
  if (/\s+and\s+/i.test(authors)) return authors.trim();
  return authors
    .split(/[;\n]+/)
    .map((author) => author.trim())
    .filter(Boolean)
    .join(" and ");
}

function cleanField(value: string): string {
  return value.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

export function formToBibtex(form: ReferenceFormData, existingKeys: Set<string> = new Set()): string {
  const author = normalizedAuthors(cleanField(form.authors));
  const fields: Record<string, string> = {
    author,
    title: cleanField(form.title),
    year: cleanField(form.year),
  };
  if (form.type === "article") fields.journal = cleanField(form.container);
  if (form.type === "incollection" || form.type === "inproceedings") {
    fields.booktitle = cleanField(form.container);
  }
  fields.publisher = cleanField(form.publisher);
  fields.volume = cleanField(form.volume);
  fields.number = cleanField(form.issue);
  fields.pages = cleanField(form.pages);
  fields.doi = cleanField(form.doi).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  fields.isbn = cleanField(form.isbn);
  fields.pmid = cleanField(form.pmid);
  fields.url = cleanField(form.url);
  const key = generateCiteKey(fields, existingKeys);
  return stringifyBibEntry({ type: form.type, key, fields });
}

export function bibtexToForm(bibtex: string): ReferenceFormData | null {
  const parsed = parseBib(bibtex).entries[0];
  if (!parsed) return null;
  const type: ReferenceEntryType = ["article", "book", "incollection", "inproceedings", "misc"].includes(parsed.type)
    ? (parsed.type as ReferenceEntryType)
    : "misc";
  return {
    type,
    title: parsed.fields.title ?? "",
    authors: parsed.fields.author?.replace(/\s+and\s+/gi, "; ") ?? "",
    year: parsed.fields.year ?? "",
    container: parsed.fields.journal ?? parsed.fields.booktitle ?? "",
    publisher: parsed.fields.publisher ?? "",
    volume: parsed.fields.volume ?? "",
    issue: parsed.fields.number ?? "",
    pages: parsed.fields.pages ?? "",
    doi: parsed.fields.doi ?? "",
    isbn: parsed.fields.isbn ?? "",
    pmid: parsed.fields.pmid ?? "",
    url: parsed.fields.url ?? "",
  };
}

export interface BibtexInspection {
  entries: number;
  errors: string[];
  findings: BibFinding[];
}

export function inspectBibtex(bibtex: string): BibtexInspection {
  if (!bibtex.trim()) return { entries: 0, errors: [], findings: [] };
  if (bibtex.length > MAX_BIBTEX_CHARACTERS) {
    return {
      entries: 0,
      errors: ["This bibliography is larger than the 1 MB workspace limit."],
      findings: [],
    };
  }
  const parsed = parseBib(bibtex);
  const errors = [...parsed.parseErrors];
  if (parsed.entries.length === 0 && errors.length === 0) {
    errors.push("No complete BibTeX entries were found.");
  }
  return {
    entries: parsed.entries.length,
    errors,
    findings: validateBib(parsed.entries),
  };
}

export type UrlCitationTarget =
  | { kind: DetectedInput["kind"]; value: string }
  | { kind: "url"; value: string };

export function detectCitationTarget(raw: string): UrlCitationTarget {
  const input = raw.trim();
  const detected = detectInput(input);
  if (detected.kind !== "title") return detected;
  try {
    const url = new URL(input);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return { kind: "url", value: url.toString() };
    }
  } catch {
    // A normal title is a valid lookup target.
  }
  return detected;
}

export function webpageBibtex(url: string, title = "Untitled webpage"): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(i18n.t(($) => $.researchTools.referenceErrors.webAddress));
  }
  const fields = {
    title: cleanField(title) || "Untitled webpage",
    howpublished: parsed.hostname.replace(/^www\./, ""),
    url: parsed.toString(),
    note: `Accessed ${new Date().toISOString().slice(0, 10)}`,
  };
  return stringifyBibEntry({
    type: "misc",
    key: generateCiteKey(fields, new Set()),
    fields,
  });
}
