import type { ParsedBib } from "./types";

/** Parse a single BibTeX entry (tolerant of nested braces, quoted, or bare values). */
export function parseEntry(bibtex: string): ParsedBib | null {
  const text = bibtex.trim();
  const head = /^@(\w+)\s*\{\s*([^,\s}]+)\s*,/.exec(text);
  if (!head) return null;
  const type = head[1].toLowerCase();
  const key = head[2];
  const body = text.slice(head[0].length);

  const fields: Record<string, string> = {};
  let i = 0;
  while (i < body.length) {
    const fm = /([A-Za-z]+)\s*=\s*/.exec(body.slice(i));
    if (!fm) break;
    const name = fm[1].toLowerCase();
    i += (fm.index ?? 0) + fm[0].length;

    let value = "";
    if (body[i] === "{") {
      let depth = 0;
      let j = i;
      for (; j < body.length; j++) {
        if (body[j] === "{") depth++;
        else if (body[j] === "}") {
          depth--;
          if (depth === 0) {
            j++;
            break;
          }
        }
      }
      value = body.slice(i + 1, j - 1);
      i = j;
    } else if (body[i] === '"') {
      let j = i + 1;
      for (; j < body.length && body[j] !== '"'; j++);
      value = body.slice(i + 1, j);
      i = j + 1;
    } else {
      let j = i;
      for (; j < body.length && body[j] !== "," && body[j] !== "}" && body[j] !== "\n"; j++);
      value = body.slice(i, j);
      i = j;
    }
    fields[name] = value.trim();

    const nc = body.indexOf(",", i);
    if (nc === -1) break;
    i = nc + 1;
  }
  return { type, key, fields };
}

const STOP = new Set(["the", "a", "an", "of", "on", "in", "for", "and", "to", "with", "using", "via", "from", "by"]);

function ascii(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[^\w]/g, "")
    .toLowerCase();
}

function firstAuthorFamily(author: string): string {
  const first = author.split(/\s+and\s+/i)[0]?.trim() ?? "";
  if (!first) return "";
  if (first.includes(",")) return first.split(",")[0].trim();
  const parts = first.split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

function firstTitleWord(title: string): string {
  for (const w of title.replace(/[{}]/g, "").split(/\s+/)) {
    const c = w.replace(/[^A-Za-z]/g, "").toLowerCase();
    if (c.length > 2 && !STOP.has(c)) return c;
  }
  return "";
}

/** Generate a `firstauthorYEARword` cite key, deduped against existing keys. */
export function generateCiteKey(fields: Record<string, string>, existing: Set<string>): string {
  const family = ascii(firstAuthorFamily(fields.author ?? ""));
  const year = (fields.year ?? "").match(/\d{4}/)?.[0] ?? "";
  const word = firstTitleWord(fields.title ?? "");
  let base = `${family}${year}${word}`;
  if (!base) base = `ref${year || ""}` || "ref";
  let key = base;
  let n = 0;
  while (existing.has(key)) {
    key = base + String.fromCharCode(97 + n);
    n++;
  }
  return key;
}

/** Replace the citation key in a BibTeX entry. */
export function setKey(bibtex: string, newKey: string): string {
  return bibtex.replace(/(@\w+\s*\{\s*)[^,\s}]+/, `$1${newKey}`);
}
