import type { ZoteroHit } from "@oleafly/backend-port";
import { type HayagrivaEntry, hayagrivaEntries, isHayagrivaPath, looksLikeHayagriva } from "@/lib/citation/hayagriva";
import { parseBib } from "@/lib/latex-tools";
import { listFiles, readFileContent } from "@/lib/tauri";
import { hitTitle } from "@/lib/zotero/format";
import type { CitationItem, NoteItem } from "./types";

export const CITEKEY_PROPERTY = "citekey";
const NAME_SEPARATOR = /(?<!\s)\s+and\s+/u;

function plain(value: string | undefined): string {
  return (value ?? "").replaceAll(/[{}]/gu, "").replaceAll(/\s+/gu, " ").trim();
}

function familyName(person: string): string {
  const name = plain(person);
  if (name.includes(",")) return name.slice(0, name.indexOf(",")).trim();
  if (/^\{.*\}$/u.test(person.trim())) return name;
  return name.split(" ").at(-1) ?? name;
}

function people(field: string | undefined): string {
  if (!field?.trim()) return "";
  const names = field.split(NAME_SEPARATOR);
  const first = familyName(names[0]);
  return names.length > 1 ? `${first} et al.` : first;
}

function citationLead(fields: Readonly<Record<string, string>>): string {
  return [people(fields.author ?? fields.editor), citationYear(fields)].filter(Boolean).join(" ");
}

export function citationLabel(key: string, fields: Readonly<Record<string, string>>): string {
  const lead = citationLead(fields);
  const title = plain(fields.title);
  if (lead && title) return `${lead}, ${title}`;
  return lead || title || key;
}

export function referenceLine(entry: CitationItem): string {
  const fields = entry.fields ?? {};
  const authors = citationAuthors(fields).join(", ");
  const year = citationYear(fields);
  const head = [authors, year && `(${year})`].filter(Boolean).join(" ");
  const doi = plain(fields.doi);
  return [head, plain(fields.title), citationVenue(fields), doi && `https://doi.org/${doi}`].filter(Boolean).join(". ") || entry.label;
}

export function citekeyOf(note: NoteItem): string | null {
  const key = note.properties?.[CITEKEY_PROPERTY];
  return typeof key === "string" && key.trim() ? key.trim() : null;
}

export function matchingCitations(citations: readonly CitationItem[], query: string): readonly CitationItem[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return citations;
  return citations.filter(
    (citation) => citation.key.toLocaleLowerCase().includes(needle) || citation.label.toLocaleLowerCase().includes(needle),
  );
}

export function citationTitle(entry: CitationItem): string {
  return plain(entry.fields?.title) || entry.key;
}

export function zoteroReference(hit: ZoteroHit): CitationItem {
  const fields: Record<string, string> = { author: hit.authors.join(" and "), title: hitTitle(hit) };
  if (hit.year) fields.year = hit.year;
  if (hit.doi) fields.doi = hit.doi;
  return { key: hit.citationKey, label: citationLabel(hit.citationKey, fields), fields };
}

export function citationVenue(fields: Readonly<Record<string, string>>): string {
  return plain(fields.journal ?? fields.booktitle ?? fields.publisher ?? fields.venue);
}

export function citationYear(fields: Readonly<Record<string, string>>): string {
  return plain(fields.year) || (/^\d{4}/u.exec(plain(fields.date))?.[0] ?? "");
}

export function citationAuthors(fields: Readonly<Record<string, string>>): string[] {
  const field = fields.author ?? fields.editor;
  return field?.trim() ? field.split(NAME_SEPARATOR).map(plain).filter(Boolean) : [];
}

export interface CitedItem {
  readonly key: string;
  readonly prefix: string;
  readonly locator: string;
}

export interface CitationGroup {
  readonly from: number;
  readonly to: number;
  readonly items: readonly CitedItem[];
}

const CITATION_GROUP = /\[((?:[^[\]\n]*?[\s;])?-?@[\p{L}\p{N}_][^[\]\n]*)\]/gu;
const KEY_START = /-?@(?=[\p{L}\p{N}_])/u;
const KEY_BODY = /[\p{L}\p{N}_](?:[\p{L}\p{N}_]|[:.#$%&+?~/-](?=[\p{L}\p{N}_]))*/uy;

export function inlineCitation(group: CitationGroup, entries: ReadonlyMap<string, CitationItem>): string {
  const parts = group.items.map((item) => {
    const entry = entries.get(item.key);
    const lead = (entry?.fields && citationLead(entry.fields)) || entry?.label || item.key;
    return [item.prefix, [lead, item.locator].filter(Boolean).join(", ")].filter(Boolean).join(" ");
  });
  return `(${parts.join("; ")})`;
}

function citedItem(part: string): CitedItem | null {
  const start = KEY_START.exec(part);
  if (!start) return null;
  KEY_BODY.lastIndex = start.index + start[0].length;
  const key = KEY_BODY.exec(part);
  if (!key) return null;
  return {
    key: key[0],
    prefix: part.slice(0, start.index).trim(),
    locator: part.slice(KEY_BODY.lastIndex).replace(/^\s*,\s*/u, "").trim(),
  };
}

export function citationGroups(text: string): CitationGroup[] {
  const groups: CitationGroup[] = [];
  for (const match of text.matchAll(CITATION_GROUP)) {
    const items: CitedItem[] = [];
    for (const part of match[1].split(";")) {
      const item = citedItem(part.trim());
      if (item) items.push(item);
    }
    if (items.length > 0) groups.push({ from: match.index, to: match.index + match[0].length, items });
  }
  return groups;
}

interface CitedEntry {
  readonly key: string;
  readonly fields: Readonly<Record<string, string>>;
}

function isBibPath(path: string): boolean {
  return path.toLowerCase().endsWith(".bib");
}

function hayagrivaFields(entry: HayagrivaEntry): Record<string, string> {
  const fields: Record<string, string> = {};
  if (entry.author?.value) fields.author = entry.author.value;
  if (entry.title?.value) fields.title = entry.title.value;
  if (entry.date?.value) fields.date = entry.date.value;
  if (entry.doi) fields.doi = entry.doi;
  return fields;
}

function entriesIn(path: string, source: string): CitedEntry[] {
  if (isBibPath(path)) return parseBib(source).entries;
  if (!looksLikeHayagriva(source)) return [];
  return hayagrivaEntries(source)
    .filter((entry) => entry.isEntry)
    .map((entry) => ({ key: entry.key, fields: hayagrivaFields(entry) }));
}

export async function projectCitations(projectId: string): Promise<CitationItem[]> {
  const files = (await listFiles(projectId)).filter(
    (entry) => !entry.is_dir && !entry.unreadable && (isBibPath(entry.path) || isHayagrivaPath(entry.path)),
  );
  const sources = await Promise.all(files.map((file) => readFileContent(projectId, file.path).catch(() => "")));
  const seen = new Set<string>();
  const items: CitationItem[] = [];
  files.forEach((file, index) => {
    for (const entry of entriesIn(file.path, sources[index])) {
      if (seen.has(entry.key)) continue;
      seen.add(entry.key);
      items.push({ key: entry.key, label: citationLabel(entry.key, entry.fields), fields: entry.fields });
    }
  });
  return items;
}
