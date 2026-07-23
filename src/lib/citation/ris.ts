import type { ParsedBib } from "./types";
import { generateCiteKey } from "./bibtex";
import { toBibName } from "./text";

// RIS type codes -> BibTeX entry types. Unlisted codes fall back to "misc".
const RIS_TYPE_MAP: Record<string, string> = {
  JOUR: "article",
  JFULL: "article",
  MGZN: "article",
  NEWS: "article",
  BOOK: "book",
  CHAP: "incollection",
  CONF: "inproceedings",
  CPAPER: "inproceedings",
  THES: "phdthesis",
  RPRT: "techreport",
  UNPB: "unpublished",
  ELEC: "misc",
  GEN: "misc",
};

interface RisRecord {
  fields: Map<string, string[]>;
}

function parseRisRecords(text: string): RisRecord[] {
  const records: RisRecord[] = [];
  let current = new Map<string, string[]>();
  const lines = text.split(/\r\n|\r|\n/);
  for (const line of lines) {
    const m = /^([A-Z][A-Z0-9])\s{0,2}-\s?(.*)$/.exec(line);
    if (!m) continue;
    const [, tag, value] = m;
    if (tag === "ER") {
      if (current.size) records.push({ fields: current });
      current = new Map();
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed) continue;
    const existing = current.get(tag);
    if (existing) existing.push(trimmed);
    else current.set(tag, [trimmed]);
  }
  // Tolerate a final record with no trailing ER line.
  if (current.size) records.push({ fields: current });
  return records;
}

function first(fields: Map<string, string[]>, ...tags: string[]): string {
  for (const tag of tags) {
    const v = fields.get(tag)?.[0];
    if (v) return v;
  }
  return "";
}

export function parseRis(text: string): ParsedBib[] {
  const keys = new Set<string>();
  const entries: ParsedBib[] = [];
  for (const { fields } of parseRisRecords(text)) {
    const typeCode = first(fields, "TY").toUpperCase();
    const type = RIS_TYPE_MAP[typeCode] ?? "misc";
    const authors = (fields.get("AU") ?? fields.get("A1") ?? []).map(toBibName);
    const title = first(fields, "TI", "T1");
    const year = (first(fields, "PY", "Y1").match(/\d{4}/) ?? [])[0] ?? "";
    const journal = first(fields, "T2", "JO", "JF");
    const volume = first(fields, "VL");
    const issue = first(fields, "IS");
    const startPage = first(fields, "SP");
    const endPage = first(fields, "EP");
    const doi = first(fields, "DO", "DOI");
    const url = first(fields, "UR");
    const publisher = first(fields, "PB");

    const entryFields: Record<string, string> = { title, author: authors.join(" and "), year };
    if (journal) entryFields.journal = journal;
    if (volume) entryFields.volume = volume;
    if (issue) entryFields.number = issue;
    if (startPage) entryFields.pages = endPage ? `${startPage}--${endPage}` : startPage;
    if (doi) entryFields.doi = doi;
    if (url) entryFields.url = url;
    if (publisher) entryFields.publisher = publisher;

    const key = generateCiteKey(entryFields, keys);
    keys.add(key);
    entries.push({ type, key, fields: entryFields });
  }
  return entries;
}
