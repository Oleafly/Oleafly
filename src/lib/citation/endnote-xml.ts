import type { ParsedBib } from "./types";
import { generateCiteKey } from "./bibtex";
import { cleanField, stripTags, toBibName } from "./text";

// EndNote's "ref-type name" attribute -> BibTeX entry type.
const REF_TYPE_MAP: Record<string, string> = {
  "journal article": "article",
  "magazine article": "article",
  "newspaper article": "article",
  book: "book",
  "book section": "incollection",
  "conference paper": "inproceedings",
  "conference proceedings": "proceedings",
  thesis: "phdthesis",
  report: "techreport",
  "electronic article": "misc",
  "web page": "misc",
};

function tag(source: string, name: string): string {
  const re = new RegExp(String.raw`<${name}[^>]*>([\s\S]*?)<\/${name}>`);
  return cleanField(stripTags(re.exec(source)?.[1] ?? "").replace(/\s+/g, " ").trim());
}

function tagAll(source: string, name: string): string[] {
  const re = new RegExp(String.raw`<${name}[^>]*>([\s\S]*?)<\/${name}>`, "g");
  return [...source.matchAll(re)].map((m) => cleanField(stripTags(m[1]).trim())).filter(Boolean);
}

function endNoteRecord(rec: string): { type: string; fields: Record<string, string> } | null {
  const refTypeName = (/<ref-type\s+name="([^"]*)"/.exec(rec)?.[1] ?? "").toLowerCase();
  const type = REF_TYPE_MAP[refTypeName] ?? "misc";

  const authorsBlock = /<contributors>([\s\S]*?)<\/contributors>/.exec(rec)?.[1] ?? "";
  const authors = tagAll(authorsBlock, "author").map(toBibName);

  const titlesBlock = /<titles>([\s\S]*?)<\/titles>/.exec(rec)?.[1] ?? rec;
  const title = tag(titlesBlock, "title");
  const journal = tag(titlesBlock, "secondary-title") || tag(rec, "full-title");

  const year = (/\d{4}/.exec(tag(rec, "year")) ?? [])[0] ?? "";
  const volume = tag(rec, "volume");
  const number = tag(rec, "number");
  const pages = tag(rec, "pages").replace(/-(?!-)/, "--");
  const publisher = tag(rec, "publisher");
  const doi = tag(rec, "electronic-resource-num");
  const url = tag(rec, "url");

  if (!title && !authors.length) return null;

  const fields: Record<string, string> = { title, author: authors.join(" and "), year };
  if (journal) fields.journal = journal;
  if (volume) fields.volume = volume;
  if (number) fields.number = number;
  if (pages) fields.pages = pages;
  if (publisher) fields.publisher = publisher;
  if (doi) fields.doi = doi;
  if (url) fields.url = url;
  return { type, fields };
}

export function parseEndNoteXml(xml: string): ParsedBib[] {
  const keys = new Set<string>();
  const entries: ParsedBib[] = [];
  for (const m of xml.matchAll(/<record>([\s\S]*?)<\/record>/g)) {
    const record = endNoteRecord(m[1]);
    if (!record) continue;
    const key = generateCiteKey(record.fields, keys);
    keys.add(key);
    entries.push({ type: record.type, key, fields: record.fields });
  }
  return entries;
}
