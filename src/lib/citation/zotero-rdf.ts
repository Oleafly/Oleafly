import type { ParsedBib } from "./types";
import { generateCiteKey } from "./bibtex";
import { cleanField } from "./text";

// Zotero's z:itemType (or the RDF element's local name when itemType is absent)
// -> BibTeX entry type.
const ITEM_TYPE_MAP: Record<string, string> = {
  journalarticle: "article",
  magazinearticle: "article",
  newspaperarticle: "article",
  book: "book",
  booksection: "incollection",
  conferencepaper: "inproceedings",
  thesis: "phdthesis",
  report: "techreport",
  webpage: "misc",
  document: "misc",
};

// Extracts the raw inner markup of a namespaced or bare tag (namespace prefix
// ignored, since Zotero's exact prefixes have varied across versions).
function rawBlock(source: string, localName: string): string {
  const re = new RegExp(`<(?:[\\w.-]+:)?${localName}[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${localName}>`);
  return re.exec(source)?.[1] ?? "";
}

// Extracts a tag's inner text with any nested markup stripped.
function textOf(source: string, localName: string): string {
  return cleanField(rawBlock(source, localName).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
}

function rawBlockAll(source: string, localName: string): string[] {
  const re = new RegExp(`<(?:[\\w.-]+:)?${localName}[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${localName}>`, "g");
  return [...source.matchAll(re)].map((m) => m[1]);
}

function extractAuthors(body: string): string[] {
  const authorsBlock = rawBlock(body, "authors") || body;
  return rawBlockAll(authorsBlock, "Person")
    .map((person) => {
      const surname = textOf(person, "surname");
      const given = textOf(person, "givenname");
      if (!surname && !given) return "";
      return given ? `${surname}, ${given}` : surname;
    })
    .filter(Boolean);
}

// Each top-level bibliographic record is a <bib:Article>, <bib:BookSection>,
// <z:Book>, etc. — any such element carrying a dc:title is treated as one record.
const RECORD_RE = /<((?:\w[\w.-]*:)?[A-Z]\w*)\s+rdf:about="[^"]*">([\s\S]*?)<\/\1>/g;

export function parseZoteroRdf(rdf: string): ParsedBib[] {
  const keys = new Set<string>();
  const entries: ParsedBib[] = [];
  for (const m of rdf.matchAll(RECORD_RE)) {
    const [, tagName, body] = m;
    const title = textOf(body, "title");
    if (!title) continue; // container elements (bib:Journal, foaf:Person, ...) have no title of their own

    const itemType = textOf(body, "itemType").toLowerCase().replace(/\s+/g, "");
    const localName = (tagName.split(":").pop() ?? tagName).toLowerCase();
    const type = ITEM_TYPE_MAP[itemType] ?? ITEM_TYPE_MAP[localName] ?? "misc";

    const authors = extractAuthors(body);
    const date = textOf(body, "date");
    const year = (date.match(/\d{4}/) ?? [])[0] ?? "";
    const journal = textOf(rawBlock(body, "isPartOf"), "title");
    const identifier = textOf(body, "identifier");
    const doi = /DOI\s+(\S+)/i.exec(identifier)?.[1] ?? "";
    const publisherBlock = rawBlock(body, "publisher");
    const publisher = textOf(publisherBlock, "Organization") || textOf(publisherBlock, "title");

    const fields: Record<string, string> = { title, author: authors.join(" and "), year };
    if (journal) fields.journal = journal;
    if (doi) fields.doi = doi;
    if (publisher) fields.publisher = publisher;

    const key = generateCiteKey(fields, keys);
    keys.add(key);
    entries.push({ type, key, fields });
  }
  return entries;
}
