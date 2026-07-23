import type { ParsedBib } from "./types";
import { generateCiteKey } from "./bibtex";
import { cleanField, toBibName } from "./text";

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
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`);
  return cleanField((re.exec(source)?.[1] ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
}

function tagAll(source: string, name: string): string[] {
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "g");
  return [...source.matchAll(re)].map((m) => cleanField(m[1].replace(/<[^>]+>/g, "").trim())).filter(Boolean);
}

export function parseEndNoteXml(xml: string): ParsedBib[] {
  const keys = new Set<string>();
  const entries: ParsedBib[] = [];
  for (const m of xml.matchAll(/<record>([\s\S]*?)<\/record>/g)) {
    const rec = m[1];

    const refTypeName = (/<ref-type\s+name="([^"]*)"/.exec(rec)?.[1] ?? "").toLowerCase();
    const type = REF_TYPE_MAP[refTypeName] ?? "misc";

    const authorsBlock = /<contributors>([\s\S]*?)<\/contributors>/.exec(rec)?.[1] ?? "";
    const authors = tagAll(authorsBlock, "author").map(toBibName);

    const titlesBlock = /<titles>([\s\S]*?)<\/titles>/.exec(rec)?.[1] ?? rec;
    const title = tag(titlesBlock, "title");
    const journal = tag(titlesBlock, "secondary-title") || tag(rec, "full-title");

    const year = (tag(rec, "year").match(/\d{4}/) ?? [])[0] ?? "";
    const volume = tag(rec, "volume");
    const number = tag(rec, "number");
    const pages = tag(rec, "pages").replace(/-(?!-)/, "--");
    const publisher = tag(rec, "publisher");
    const doi = tag(rec, "electronic-resource-num");
    const url = tag(rec, "url");

    if (!title && !authors.length) continue;

    const fields: Record<string, string> = { title, author: authors.join(" and "), year };
    if (journal) fields.journal = journal;
    if (volume) fields.volume = volume;
    if (number) fields.number = number;
    if (pages) fields.pages = pages;
    if (publisher) fields.publisher = publisher;
    if (doi) fields.doi = doi;
    if (url) fields.url = url;

    const key = generateCiteKey(fields, keys);
    keys.add(key);
    entries.push({ type, key, fields });
  }
  return entries;
}
