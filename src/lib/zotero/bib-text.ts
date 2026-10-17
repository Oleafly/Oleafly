export interface BibEntrySpan {
  readonly key: string;
  readonly type: string;
  readonly from: number;
  readonly to: number;
}

export interface BibKeyIndex {
  readonly spans: readonly BibEntrySpan[];
  readonly keys: ReadonlySet<string>;
  readonly doiToKey: ReadonlyMap<string, string>;
}

const SKIPPED_TYPES = new Set(["comment", "string", "preamble"]);
const ENTRY_START = /@([A-Za-z]+)\s*([{(])/g;
const KEY_CHARS = /^[^\s,{}()]+/;

function closingIndex(text: string, open: number, closer: "}" | ")"): number {
  let depth = 0;
  for (let index = open + 1; index < text.length; index++) {
    const character = text[index];
    if (character === "{") depth++;
    else if (character === "}") {
      if (depth === 0) return closer === "}" ? index : -1;
      depth--;
    } else if (character === ")" && closer === ")" && depth === 0) {
      return index;
    }
  }
  return -1;
}

export function bibEntrySpans(text: string): BibEntrySpan[] {
  const spans: BibEntrySpan[] = [];
  ENTRY_START.lastIndex = 0;
  for (;;) {
    const match = ENTRY_START.exec(text);
    if (!match) break;
    const start = match.index;
    const type = match[1].toLowerCase();
    const open = start + match[0].length - 1;
    const close = closingIndex(text, open, match[2] === "{" ? "}" : ")");
    if (close < 0) continue;
    ENTRY_START.lastIndex = close + 1;
    if (SKIPPED_TYPES.has(type)) continue;
    const key = KEY_CHARS.exec(text.slice(open + 1, close).trimStart())?.[0];
    if (!key) continue;
    spans.push({ key, type, from: start, to: close + 1 });
  }
  return spans;
}

export function findEntry(text: string, key: string): BibEntrySpan | null {
  return bibKeyIndex(text).spans.find((span) => span.key === key) ?? null;
}

export function normalizeDoi(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const lowered = raw.trim().toLowerCase().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:)/, "").trim();
  return lowered.startsWith("10.") ? lowered : null;
}

const DOI_FIELD = /(?:^|[\s,{])doi\s*=\s*(?:\{([^{}]*)\}|"([^"]*)"|([^,\s}]+))/i;

export function entryDoi(entry: string): string | null {
  const match = DOI_FIELD.exec(entry);
  return normalizeDoi(match?.[1] ?? match?.[2] ?? match?.[3]);
}

let lastText: string | null = null;
let lastIndex: BibKeyIndex | null = null;

export function bibKeyIndex(text: string): BibKeyIndex {
  if (lastText === text && lastIndex) return lastIndex;
  const spans = bibEntrySpans(text);
  const keys = new Set<string>();
  const doiToKey = new Map<string, string>();
  for (const span of spans) {
    keys.add(span.key);
    const doi = entryDoi(text.slice(span.from, span.to));
    if (doi && !doiToKey.has(doi)) doiToKey.set(doi, span.key);
  }
  lastText = text;
  lastIndex = { spans, keys, doiToKey };
  return lastIndex;
}

export function appendEntries(text: string, entries: readonly string[]): string {
  if (entries.length === 0) return text;
  const body = entries.map((entry) => entry.trim()).join("\n\n");
  if (text.length === 0) return `${body}\n`;
  if (text.endsWith("\n\n")) return `${text}${body}\n`;
  if (text.endsWith("\n")) return `${text}\n${body}\n`;
  return `${text}\n\n${body}\n`;
}

export function replaceEntry(text: string, span: BibEntrySpan, entry: string): string {
  return `${text.slice(0, span.from)}${entry.trim()}${text.slice(span.to)}`;
}

export function entryHash(entry: string): string {
  const normalized = entry.replace(/\s+/g, " ").trim();
  let first = 0xdeadbeef;
  let second = 0x41c6ce57;
  for (const character of normalized) {
    const code = character.codePointAt(0) ?? 0;
    first = Math.imul(first ^ code, 2654435761);
    second = Math.imul(second ^ code, 1597334677);
  }
  first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
  second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);
  return `${(second >>> 0).toString(16).padStart(8, "0")}${(first >>> 0).toString(16).padStart(8, "0")}`;
}

export function withEntryKey(entry: string, key: string): string {
  return entry.trim().replace(/^(@[A-Za-z]+\s*[{(]\s*)[^\s,{}()]+/, (_match, head: string) => `${head}${key}`);
}

export function bibStyleOf(text: string): "biblatex" | "bibtex" | null {
  const biblatex = (text.match(/\b(?:journaltitle|date|location|langid)\s*=/gi) ?? []).length;
  const bibtex = (text.match(/\b(?:journal|year|address|month)\s*=/gi) ?? []).length;
  if (biblatex === 0 && bibtex === 0) return null;
  return biblatex > bibtex ? "biblatex" : "bibtex";
}

function maskLatexComments(source: string): string {
  return source.replace(/(^|[^\\])%[^\n]*/g, (match, lead: string) => `${lead}${" ".repeat(match.length - lead.length)}`);
}

const USEPACKAGE = /\\usepackage\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/g;
const DECLARATION = /\\(?:bibliography|addbibresource|addglobalbib|addsectionbib)\s*(?:\[[^\]]*\]\s*)?\{/;

export function findLatexPackage(masked: string, name: string): RegExpExecArray | null {
  for (const match of masked.matchAll(USEPACKAGE)) {
    if (match[1].split(",").some((entry) => entry.trim() === name)) return match as RegExpExecArray;
  }
  return null;
}

export function latexUsesBiblatex(source: string): boolean {
  return findLatexPackage(maskLatexComments(source), "biblatex") !== null;
}

export function latexHasBibliography(source: string): boolean {
  return DECLARATION.test(maskLatexComments(source));
}

function insertBeforeEndDocument(source: string, masked: string, lines: string): string {
  const end = masked.lastIndexOf(String.raw`\end{document}`);
  if (end < 0) {
    const separator = source.length === 0 || source.endsWith("\n") ? "" : "\n";
    return `${source}${separator}${lines}\n`;
  }
  const lineStart = source.lastIndexOf("\n", end - 1) + 1;
  const prefix = source.slice(lineStart, end);
  if (prefix.trim() === "") {
    return `${source.slice(0, lineStart)}${lines}\n${source.slice(lineStart)}`;
  }
  return `${source.slice(0, end)}\n${lines}\n${source.slice(end)}`;
}

export function ensureLatexBibliography(source: string, bibPath: string): string {
  const masked = maskLatexComments(source);
  if (DECLARATION.test(masked)) return source;
  const path = bibPath.replaceAll("\\", "/");
  const biblatex = findLatexPackage(masked, "biblatex");
  if (biblatex) {
    const lineEnd = source.indexOf("\n", biblatex.index + biblatex[0].length);
    const withResource =
      lineEnd < 0
        ? `${source}\n\\addbibresource{${path}}`
        : `${source.slice(0, lineEnd + 1)}\\addbibresource{${path}}\n${source.slice(lineEnd + 1)}`;
    if (/\\printbibliography\b/.test(maskLatexComments(withResource))) return withResource;
    return insertBeforeEndDocument(withResource, maskLatexComments(withResource), String.raw`\printbibliography`);
  }
  const stem = path.replace(/\.bib$/i, "");
  const bibliography = String.raw`\bibliography{${stem}}`;
  if (/\\bibliographystyle\s*\{/.test(masked)) return insertBeforeEndDocument(source, masked, bibliography);
  const style = findLatexPackage(masked, "natbib") ? "plainnat" : "plain";
  return insertBeforeEndDocument(source, masked, `\\bibliographystyle{${style}}\n${bibliography}`);
}
