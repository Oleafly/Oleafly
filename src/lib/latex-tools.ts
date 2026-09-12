import { i18n } from "@/i18n";
import { formatList } from "@/lib/intl";
// Pure logic behind the LaTeX tools view: BibTeX parsing/validation and
// LaTeX table generation. Kept UI-free so it is unit-testable.

import { escapeLatex } from "./citation/text";

const SPEC: Record<string, { required: string[][]; optional: string[] }> = {
  article: {
    required: [["author"], ["title"], ["journal"], ["year"]],
    optional: ["volume", "number", "pages", "month", "doi", "url"],
  },
  book: {
    required: [["title"], ["publisher"], ["year"], ["author", "editor"]],
    optional: ["volume", "series", "edition", "address", "isbn", "doi"],
  },
  inproceedings: {
    required: [["author"], ["title"], ["booktitle"], ["year"]],
    optional: ["pages", "address", "publisher", "doi"],
  },
  conference: {
    required: [["author"], ["title"], ["booktitle"], ["year"]],
    optional: ["pages", "address", "publisher"],
  },
  phdthesis: {
    required: [["author"], ["title"], ["school"], ["year"]],
    optional: ["address", "month", "type", "doi"],
  },
  mastersthesis: {
    required: [["author"], ["title"], ["school"], ["year"]],
    optional: ["address", "month", "type"],
  },
  techreport: {
    required: [["author"], ["title"], ["institution"], ["year"]],
    optional: ["type", "number", "address", "month"],
  },
  misc: {
    required: [],
    optional: ["author", "title", "year", "url", "note", "howpublished"],
  },
  unpublished: {
    required: [["author"], ["title"], ["note"]],
    optional: ["year", "month"],
  },
  proceedings: {
    required: [["title"], ["year"]],
    optional: ["editor", "publisher", "address", "volume"],
  },
  manual: {
    required: [["title"]],
    optional: ["author", "organization", "year", "edition"],
  },
  incollection: {
    required: [["author"], ["title"], ["booktitle"], ["publisher"], ["year"]],
    optional: ["editor", "chapter", "pages", "address"],
  },
};

export interface BibEntry {
  type: string;
  key: string;
  fields: Record<string, string>;
}

export interface BibFinding {
  key: string;
  type: string;
  level: "error" | "warning" | "ok";
  messages: string[];
}

function bracedBibValue(src: string, p: number): { value: string; next: number } {
  let braces = 1;
  let cursor = p + 1;
  const start = cursor;
  while (cursor < src.length && braces > 0) {
    if (src[cursor] === "{") braces++;
    else if (src[cursor] === "}") braces--;
    if (braces > 0) cursor++;
  }
  return { value: src.slice(start, cursor), next: cursor + 1 };
}

function quotedBibValue(src: string, p: number): { value: string; next: number } {
  let cursor = p + 1;
  const start = cursor;
  while (cursor < src.length && src[cursor] !== '"') cursor++;
  return { value: src.slice(start, cursor), next: cursor + 1 };
}

function bareBibValue(src: string, p: number): { value: string; next: number } {
  let cursor = p;
  while (cursor < src.length && !/[\s,}]/.test(src[cursor])) cursor++;
  return { value: src.slice(p, cursor), next: cursor };
}

function bibFieldValue(src: string, p: number): { value: string; next: number } {
  if (src[p] === "{") return bracedBibValue(src, p);
  if (src[p] === '"') return quotedBibValue(src, p);
  return bareBibValue(src, p);
}

function readEntryFields(
  src: string,
  start: number,
  key: string,
  type: string,
  parseErrors: string[],
): { fields: Record<string, string>; next: number } {
  const fields: Record<string, string> = {};
  let p = start;
  let depth = 1;
  while (p < src.length && depth > 0) {
    while (p < src.length && /[\s,]/.test(src[p])) p++;
    if (src[p] === "}") {
      depth--;
      p++;
      break;
    }
    const nameMatch = /^([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*/.exec(src.slice(p));
    if (!nameMatch) {
      const close = src.indexOf("}", p);
      parseErrors.push(
        i18n.t(($) => $.core.bibtex.unreadableFields, { entry: key || type }),
      );
      p = close < 0 ? src.length : close + 1;
      break;
    }
    const name = nameMatch[1].toLowerCase();
    p += nameMatch[0].length;
    const parsed = bibFieldValue(src, p);
    p = parsed.next;
    fields[name] = parsed.value.replace(/\s+/g, " ").trim();
  }
  return { fields, next: p };
}

function readBibEntry(
  src: string,
  at: number,
  entries: BibEntry[],
  parseErrors: string[],
): number | null {
  const typeMatch = /^([a-zA-Z]+)\s*\{/.exec(src.slice(at + 1));
  if (!typeMatch) return at + 1;
  const type = typeMatch[1].toLowerCase();
  const afterType = at + 1 + typeMatch[0].length;
  if (type === "comment" || type === "preamble" || type === "string") {
    return afterType;
  }
  const keyEnd = src.slice(afterType).search(/[,}]/);
  if (keyEnd < 0) {
    parseErrors.push(
      i18n.t(($) => $.core.bibtex.unterminatedEntry, { position: at }),
    );
    return null;
  }
  const key = src.slice(afterType, afterType + keyEnd).trim();
  const parsed = readEntryFields(
    src,
    afterType + keyEnd,
    key,
    type,
    parseErrors,
  );
  if (key) entries.push({ type, key, fields: parsed.fields });
  else parseErrors.push(i18n.t(($) => $.core.bibtex.missingKey, { type }));
  return parsed.next;
}

/** Tolerant BibTeX parser: balanced-brace field values, quoted values, bare numbers. */
export function parseBib(src: string): { entries: BibEntry[]; parseErrors: string[] } {
  const entries: BibEntry[] = [];
  const parseErrors: string[] = [];
  let i = 0;
  while (i < src.length) {
    const at = src.indexOf("@", i);
    if (at < 0) break;
    const next = readBibEntry(src, at, entries, parseErrors);
    if (next === null) break;
    i = next;
  }
  return { entries, parseErrors };
}

type BibSpec = { required: string[][]; optional: string[] };

const ALWAYS_ALLOWED_FIELDS = ["keywords", "abstract", "note", "url", "doi"];

function missingFieldMessages(spec: BibSpec, entry: BibEntry): string[] {
  const messages: string[] = [];
  for (const group of spec.required) {
    if (group.some((f) => entry.fields[f]?.length)) continue;
    messages.push(
      i18n.t(($) => $.core.bibtex.missingField, {
        fields: formatList(group, { type: "disjunction" }),
      }),
    );
  }
  return messages;
}

function unusualFieldMessages(spec: BibSpec, entry: BibEntry): string[] {
  const known = new Set([...spec.required.flat(), ...spec.optional]);
  const messages: string[] = [];
  for (const f of Object.keys(entry.fields)) {
    if (known.has(f) || ALWAYS_ALLOWED_FIELDS.includes(f)) continue;
    messages.push(
      i18n.t(($) => $.core.bibtex.unusualField, { type: entry.type, field: f }),
    );
  }
  return messages;
}

function duplicateKeyMessages(
  entry: BibEntry,
  seenKeys: Map<string, number>,
): string[] {
  if ((seenKeys.get(entry.key) ?? 0) > 1) {
    return [i18n.t(($) => $.core.bibtex.duplicateKey)];
  }
  return [];
}

function softMessages(
  entry: BibEntry,
  doiToKeys: Map<string, string[]>,
): string[] {
  const messages: string[] = [];
  const doi = entry.fields.doi?.toLowerCase();
  if (doi && (doiToKeys.get(doi)?.length ?? 0) > 1) {
    messages.push(
      i18n.t(($) => $.core.bibtex.duplicateDoi, {
        keys: formatList(doiToKeys.get(doi)?.filter((k) => k !== entry.key) ?? []),
      }),
    );
  }
  const year = entry.fields.year;
  if (year && !/^\d{4}$/.test(year)) {
    messages.push(i18n.t(($) => $.core.bibtex.invalidYear, { year }));
  }
  return messages;
}

function bibEntryFinding(
  entry: BibEntry,
  seenKeys: Map<string, number>,
  doiToKeys: Map<string, string[]>,
): BibFinding {
  const messages: string[] = [];
  let level: BibFinding["level"] = "ok";
  const spec = SPEC[entry.type];
  if (!spec) {
    messages.push(i18n.t(($) => $.core.bibtex.unknownType, { type: entry.type }));
    level = "warning";
  } else {
    const missing = missingFieldMessages(spec, entry);
    if (missing.length > 0) level = "error";
    const unusual = unusualFieldMessages(spec, entry);
    if (unusual.length > 0 && level === "ok") level = "warning";
    messages.push(...missing, ...unusual);
  }
  const duplicates = duplicateKeyMessages(entry, seenKeys);
  if (duplicates.length > 0) level = "error";
  const soft = softMessages(entry, doiToKeys);
  if (soft.length > 0 && level === "ok") level = "warning";
  messages.push(...duplicates, ...soft);
  return { key: entry.key, type: entry.type, level, messages };
}

export function validateBib(entries: BibEntry[]): BibFinding[] {
  const seenKeys = new Map<string, number>();
  const doiToKeys = new Map<string, string[]>();
  for (const e of entries) {
    seenKeys.set(e.key, (seenKeys.get(e.key) ?? 0) + 1);
    const doi = e.fields.doi?.toLowerCase();
    if (doi) doiToKeys.set(doi, [...(doiToKeys.get(doi) ?? []), e.key]);
  }
  return entries.map((e) => bibEntryFinding(e, seenKeys, doiToKeys));
}

export type TableAlign = "l" | "c" | "r";

function booktabsBody(
  cells: string[][],
  headerRow: boolean,
  row: (r: string[]) => string,
): string[] {
  const lines = [String.raw`    \toprule`];
  if (headerRow && cells.length > 0) {
    lines.push(row(cells[0]), String.raw`    \midrule`);
    for (const r of cells.slice(1)) lines.push(row(r));
  } else {
    for (const r of cells) lines.push(row(r));
  }
  lines.push(String.raw`    \bottomrule`);
  return lines;
}

function hlineBody(
  cells: string[][],
  headerRow: boolean,
  row: (r: string[]) => string,
): string[] {
  const lines = [String.raw`    \hline`];
  for (const [i, r] of cells.entries()) {
    lines.push(row(r));
    if (i === 0 && headerRow) lines.push(String.raw`    \hline`);
  }
  lines.push(String.raw`    \hline`);
  return lines;
}

export function buildLatexTable(
  cells: string[][],
  aligns: TableAlign[],
  opts: { booktabs: boolean; headerRow: boolean; caption: string },
): string {
  const colSpec = aligns.join("");
  const row = (r: string[]) => `    ${r.map(escapeLatex).join(" & ")} \\\\`;
  const lines: string[] = [];
  lines.push(String.raw`\begin{table}[htbp]`, String.raw`  \centering`);
  if (opts.caption) lines.push(String.raw`  \caption{${escapeLatex(opts.caption)}}`);
  lines.push(String.raw`  \begin{tabular}{${colSpec}}`);
  lines.push(
    ...(opts.booktabs
      ? booktabsBody(cells, opts.headerRow, row)
      : hlineBody(cells, opts.headerRow, row)),
  );
  lines.push(String.raw`  \end{tabular}`, String.raw`\end{table}`);
  return lines.join("\n");
}

export function resizeTable(cells: string[][], rows: number, cols: number): string[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => cells[r]?.[c] ?? ""),
  );
}
