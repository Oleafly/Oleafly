import type { ParsedBib } from "./types";

type EntryValue = { value: string; next: number };

function bracedEntryValue(body: string, i: number): EntryValue {
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
  return { value: body.slice(i + 1, j - 1), next: j };
}

function quotedEntryValue(body: string, i: number): EntryValue {
  let j = i + 1;
  for (; j < body.length && body[j] !== '"'; j++);
  return { value: body.slice(i + 1, j), next: j + 1 };
}

function bareEntryValue(body: string, i: number): EntryValue {
  let j = i;
  for (; j < body.length && body[j] !== "," && body[j] !== "}" && body[j] !== "\n"; j++);
  return { value: body.slice(i, j), next: j };
}

function entryValue(body: string, i: number): EntryValue {
  if (body[i] === "{") return bracedEntryValue(body, i);
  if (body[i] === '"') return quotedEntryValue(body, i);
  return bareEntryValue(body, i);
}

function parseEntryFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let i = 0;
  while (i < body.length) {
    const fm = /(?<![A-Za-z])([A-Za-z]+)\s*=\s*/.exec(body.slice(i));
    if (!fm) break;
    const name = fm[1].toLowerCase();
    i += (fm.index ?? 0) + fm[0].length;

    const parsed = entryValue(body, i);
    i = parsed.next;
    fields[name] = parsed.value.trim();

    const nc = body.indexOf(",", i);
    if (nc === -1) break;
    i = nc + 1;
  }
  return fields;
}

// Tolerant of nested braces, quoted, or bare field values.
export function parseEntry(bibtex: string): ParsedBib | null {
  const text = bibtex.trim();
  const head = /^@(\w+)\s*\{\s*([^,\s}]+)\s*,/.exec(text);
  if (!head) return null;
  return {
    type: head[1].toLowerCase(),
    key: head[2],
    fields: parseEntryFields(text.slice(head[0].length)),
  };
}

const STOP = new Set(["the", "a", "an", "of", "on", "in", "for", "and", "to", "with", "using", "via", "from", "by"]);

function ascii(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[^\w]/g, "")
    .toLowerCase();
}

function firstAuthorFamily(author: string): string {
  const first = author.split(/(?<!\s)\s+and\s+/i)[0]?.trim() ?? "";
  if (!first) return "";
  if (first.includes(",")) return first.split(",")[0].trim();
  const parts = first.split(/\s+/);
  return parts.at(-1) ?? "";
}

function firstTitleWord(title: string): string {
  for (const w of title.replace(/[{}]/g, "").split(/\s+/)) {
    const c = w.replace(/[^A-Za-z]/g, "").toLowerCase();
    if (c.length > 2 && !STOP.has(c)) return c;
  }
  return "";
}

// Bijective base-26 (a, b, ..., z, then aa, ab, ...) stays within [a-z] so the key
// remains a valid BibTeX identifier even past the 26th collision (the old
// `String.fromCharCode(97 + n)` walked into '{', '|', '}').
function collisionSuffix(n: number): string {
  let s = "";
  let i = n;
  do {
    s = String.fromCodePoint(97 + (i % 26)) + s;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return s;
}

export function generateCiteKey(fields: Record<string, string>, existing: Set<string>): string {
  const family = ascii(firstAuthorFamily(fields.author ?? ""));
  const year = /\d{4}/.exec(fields.year ?? "")?.[0] ?? "";
  const word = firstTitleWord(fields.title ?? "");
  let base = `${family}${year}${word}`;
  if (!base) base = `ref${year}`;
  let key = base;
  let n = 0;
  while (existing.has(key)) {
    key = base + collisionSuffix(n);
    n++;
  }
  return key;
}

export function setKey(bibtex: string, newKey: string): string {
  return bibtex.replace(/(@\w+\s*\{\s*)[^,\s}]+/, `$1${newKey}`);
}

export function stringifyBibEntry(entry: ParsedBib): string {
  const lines = Object.entries(entry.fields)
    .filter(([, value]) => value.trim())
    .map(([name, value]) => `  ${name} = {${value}}`);
  return `@${entry.type}{${entry.key},\n${lines.join(",\n")}\n}`;
}
