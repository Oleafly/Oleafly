import {
  bibtexKeys,
  citationList,
  emptyInsights,
  emptyMetadata,
  TODO_MARKER,
  todoText,
  type DocumentInsightsBase,
  type InsightEntry,
  type InsightEntryKind,
  type LabelEntry,
  type SourceLocation,
  type SubmissionMetadata,
} from "./document-insights";

export type YamlValue = string | YamlValue[] | { [key: string]: YamlValue };

export interface FrontMatter {
  values: Record<string, YamlValue>;
  endLine: number;
}

export interface MarkdownInsightsInput {
  mainDoc: string;
  texts: Readonly<Record<string, string>>;
}

interface YamlLine {
  indent: number;
  text: string;
  raw: string;
}

interface Attributes {
  id: string | null;
  unnumbered: boolean;
}

interface Fence {
  char: string;
  length: number;
}

interface ImageMatch {
  readonly index: number;
  readonly text: string;
  readonly alt: string;
  readonly title: string | undefined;
  readonly attributes: string | undefined;
}

interface AtxHeading {
  readonly level: number;
  readonly text: string | undefined;
}

interface MathBlock {
  start: number;
  column: number;
  body: string[];
}

interface RawBlock {
  start: number;
  name: string;
  starred: boolean;
  body: string[];
}

const CROSSREF_PREFIX = /^(?:fig|tbl|eq|sec|lst|thm|lem|def|cor|prop|tab):/u;
const CITATION = /(?<![\p{L}\p{N}_])-?@(\{[^{}\s]+\}|[\p{L}\p{N}_][\p{L}\p{N}_:.#$%&+?<>~/-]*)/gu;
const DELIMITER_CELL = /^:?-+:?$/u;
const GRID_BORDER = /^\s*\+(?:[-=:]+\+)+\s*$/u;
const SETEXT = /^ {0,3}(?:=+|-+)\s*$/u;
const YAML_REFERENCE_ID = /(?:-\s*)?id\s*:\s*["']?([^"'\s#]+)/uy;
const LINE_BREAKS = new Set(["\n", "\r", "\u2028", "\u2029"]);
const RAW_EQUATION = /^\s*\\begin\s*\{(equation|align|gather|multline|flalign|alignat|eqnarray)(\*?)\}/u;

function isSpace(character: string | undefined): boolean {
  return character !== undefined && /\s/u.test(character);
}

function skipSpaces(text: string, from: number): number {
  let index = from;
  while (index < text.length && isSpace(text[index])) index += 1;
  return index;
}

function spaceRunStart(text: string, end: number): number {
  let start = end;
  while (start > 0 && isSpace(text[start - 1])) start -= 1;
  return start;
}

function trimTrailing(text: string, characters: string): string {
  let end = text.length;
  while (end > 0 && characters.includes(text[end - 1])) end -= 1;
  return text.slice(0, end);
}

function untilLineBreak(text: string, from: number): string {
  let end = from;
  while (end < text.length && !LINE_BREAKS.has(text[end])) end += 1;
  return text.slice(from, end);
}

function htmlCommentEnd(text: string): { index: number; length: number } | null {
  const plain = text.indexOf("-->");
  const bang = text.indexOf("--!>");
  if (plain < 0 && bang < 0) return null;
  if (bang < 0 || (plain >= 0 && plain < bang)) return { index: plain, length: 3 };
  return { index: bang, length: 4 };
}

function stripComment(value: string): string {
  let quote: string | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      if (index === 0 || /\s/u.test(value[index - 1] ?? "")) quote = char;
    } else if (char === "#" && (index === 0 || /\s/u.test(value[index - 1]))) {
      return value.slice(0, index);
    }
  }
  return value;
}

function unquote(value: string): string {
  const text = value.trim();
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replaceAll("''", "'");
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text
      .slice(1, -1)
      .replaceAll(/\\(["\\/])/gu, "$1")
      .replaceAll(String.raw`\n`, "\n")
      .replaceAll(String.raw`\t`, "\t");
  }
  return text;
}

function splitFlow(body: string): string[] {
  const items: string[] = [];
  let current = "";
  let quote: string | null = null;
  let depth = 0;
  for (const char of body) {
    if (quote) {
      if (char === quote) quote = null;
      current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === "[" || char === "{") {
      depth += 1;
      current += char;
    } else if (char === "]" || char === "}") {
      depth -= 1;
      current += char;
    } else if (char === "," && depth === 0) {
      items.push(current);
      current = "";
    } else current += char;
  }
  if (current.trim()) items.push(current);
  return items.map((item) => item.trim()).filter(Boolean);
}

function flowValue(text: string): YamlValue {
  const trimmed = text.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) return splitFlow(trimmed.slice(1, -1)).map(flowValue);
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const map: Record<string, YamlValue> = {};
    for (const pair of splitFlow(trimmed.slice(1, -1))) {
      const colon = pair.indexOf(":");
      if (colon > 0) map[unquote(pair.slice(0, colon))] = flowValue(pair.slice(colon + 1));
    }
    return map;
  }
  return unquote(trimmed);
}

function nextContent(lines: readonly YamlLine[], from: number): number {
  let index = from;
  while (index < lines.length && (lines[index].text === "" || lines[index].text.startsWith("#"))) index += 1;
  return index;
}

function chompMode(header: string): "strip" | "keep" | "clip" {
  if (header.includes("-")) return "strip";
  return header.includes("+") ? "keep" : "clip";
}

function blockText(collected: readonly string[], folded: boolean): string {
  if (!folded) return collected.join("\n");
  return collected
    .join("\n")
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.replaceAll("\n", " "))
    .join("\n");
}

function blockScalar(lines: readonly YamlLine[], from: number, parentIndent: number, header: string): [string, number] {
  const folded = header.startsWith(">");
  const chomp = chompMode(header);
  let index = from;
  let indent = -1;
  const collected: string[] = [];
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.text === "") {
      collected.push("");
      continue;
    }
    if (line.indent <= parentIndent) break;
    if (indent < 0) indent = line.indent;
    collected.push(line.raw.slice(Math.min(indent, line.indent)));
  }
  while (collected.length > 0 && collected.at(-1) === "") {
    collected.pop();
    index -= 1;
  }
  const text = blockText(collected, folded);
  return [chomp !== "strip" && text ? `${text}\n` : text, index];
}

function plainScalar(lines: readonly YamlLine[], from: number, parentIndent: number, first: string): [string, number] {
  const parts = [first];
  let index = from;
  while (index < lines.length) {
    const line = lines[index];
    if (line.text === "" || line.indent <= parentIndent || /^[^\s:#][^:]*:(?:\s|$)/u.test(line.text) || line.text.startsWith("- ")) break;
    parts.push(stripComment(line.text).trim());
    index += 1;
  }
  return [parts.join(" "), index];
}

function nestedValue(lines: readonly YamlLine[], index: number, indent: number): [YamlValue, number] {
  const next = nextContent(lines, index + 1);
  const line = lines[next];
  if (!line) return ["", next];
  if (line.text.startsWith("- ") || line.text === "-") {
    if (line.indent >= indent) return parseSequence(lines, next, line.indent);
  } else if (line.indent > indent) return parseMapping(lines, next, line.indent);
  return ["", index + 1];
}

function flowLines(lines: readonly YamlLine[], index: number, indent: number, value: string): [YamlValue, number] {
  let text = value;
  let cursor = index + 1;
  const close = value.startsWith("[") ? "]" : "}";
  while (!text.endsWith(close) && cursor < lines.length && lines[cursor].indent > indent) {
    text += ` ${stripComment(lines[cursor].text).trim()}`;
    cursor += 1;
  }
  return [flowValue(text), cursor];
}

function quotedLines(lines: readonly YamlLine[], index: number, value: string): [YamlValue, number] {
  if (value.length > 1 && value.endsWith(value[0])) return [unquote(value), index + 1];
  let text = value;
  let cursor = index + 1;
  while (cursor < lines.length && !text.endsWith(value[0])) {
    text += ` ${lines[cursor].text}`;
    cursor += 1;
  }
  return [unquote(text), cursor];
}

function parseValue(lines: readonly YamlLine[], index: number, indent: number, rest: string): [YamlValue, number] {
  const value = stripComment(rest).trim();
  if (value.startsWith("|") || value.startsWith(">")) return blockScalar(lines, index + 1, indent, value);
  if (value === "") return nestedValue(lines, index, indent);
  if (value.startsWith("[") || value.startsWith("{")) return flowLines(lines, index, indent, value);
  if (value.startsWith('"') || value.startsWith("'")) return quotedLines(lines, index, value);
  return plainScalar(lines, index + 1, indent, value);
}

function yamlKey(text: string): { raw: string; end: number } | null {
  const first = text[0];
  if (first === '"' || first === "'") {
    const close = text.indexOf(first, 1);
    return close < 0 ? null : { raw: text.slice(0, close + 1), end: close + 1 };
  }
  if (first === undefined || first === ":" || first === "#" || isSpace(first)) return null;
  const colon = text.indexOf(":");
  return colon < 0 ? null : { raw: text.slice(0, spaceRunStart(text, colon)), end: colon };
}

function keyValue(text: string): [string, string] | null {
  const key = yamlKey(text);
  if (!key) return null;
  const colon = skipSpaces(text, key.end);
  if (text[colon] !== ":") return null;
  if (colon + 1 === text.length) return [unquote(key.raw), ""];
  const value = skipSpaces(text, colon + 1);
  return value > colon + 1 ? [unquote(key.raw), untilLineBreak(text, value)] : null;
}

function parseMapping(lines: readonly YamlLine[], from: number, indent: number): [Record<string, YamlValue>, number] {
  const map: Record<string, YamlValue> = {};
  let index = from;
  while (index < lines.length) {
    const line = lines[index];
    if (line.text === "" || line.text.startsWith("#")) {
      index += 1;
      continue;
    }
    if (line.indent < indent) break;
    if (line.indent > indent || line.text.startsWith("- ")) {
      if (line.indent === indent) break;
      index += 1;
      continue;
    }
    const pair = keyValue(line.text);
    if (!pair) {
      index += 1;
      continue;
    }
    const [value, next] = parseValue(lines, index, indent, pair[1]);
    map[pair[0]] = value;
    index = Math.max(next, index + 1);
  }
  return [map, index];
}

function parseSequence(lines: readonly YamlLine[], from: number, indent: number): [YamlValue[], number] {
  const items: YamlValue[] = [];
  let index = from;
  while (index < lines.length) {
    const line = lines[index];
    if (line.text === "" || line.text.startsWith("#")) {
      index += 1;
      continue;
    }
    if (line.indent !== indent || !(line.text.startsWith("- ") || line.text === "-")) break;
    const rest = line.text.slice(1).replace(/^\s+/u, "");
    const itemIndent = indent + (line.text.length - rest.length);
    const pair = rest.startsWith('"') || rest.startsWith("'") || rest.startsWith("[") || rest.startsWith("{") ? null : keyValue(rest);
    if (pair) {
      const shifted: YamlLine[] = [...lines];
      shifted[index] = { indent: itemIndent, text: rest, raw: `${" ".repeat(itemIndent)}${rest}` };
      const [map, next] = parseMapping(shifted, index, itemIndent);
      items.push(map);
      index = next;
    } else {
      const [value, next] = parseValue(lines, index, indent, rest);
      items.push(value);
      index = Math.max(next, index + 1);
    }
  }
  return [items, index];
}

export function parseFrontMatter(text: string): FrontMatter | null {
  const lines = text.split(/\r?\n/u);
  if (!/^---\s*$/u.test(lines[0] ?? "")) return null;
  const close = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/u.test(line));
  if (close < 0) return null;
  const body: YamlLine[] = lines.slice(1, close).map((raw) => {
    const text = raw.trimEnd();
    const trimmed = text.trimStart();
    return { indent: text.length - trimmed.length, text: trimmed, raw: text };
  });
  return { values: parseMapping(body, 0, 0)[0], endLine: close + 1 };
}

function scalar(value: YamlValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function linkTexts(text: string): string {
  let out = "";
  let last = 0;
  let index = 0;
  while (index < text.length) {
    const open = text[index] === "!" && text[index + 1] === "[" ? index + 1 : index;
    if (text[open] !== "[") {
      index += 1;
      continue;
    }
    const close = text.indexOf("]", open + 1);
    if (close < 0) break;
    if (text[close + 1] !== "(") {
      index = close + 1;
      continue;
    }
    const end = text.indexOf(")", close + 2);
    if (end < 0) break;
    out += text.slice(last, index) + text.slice(open + 1, close);
    last = end + 1;
    index = end + 1;
  }
  return out + text.slice(last);
}

function markdownPlain(text: string): string {
  return linkTexts(text)
    .replaceAll(/(\*\*|__|\*|`|~~)/gu, "")
    .replaceAll(/(^|[^\p{L}\p{N}])_([^_]+)_(?=[^\p{L}\p{N}]|$)/gu, "$1$2")
    .replaceAll(/\\([\\`*_{}[\]()#+\-.!])/gu, "$1")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function paragraphs(text: string): string | null {
  const joined = text
    .split(/\n\s*\n/u)
    .map(markdownPlain)
    .filter(Boolean)
    .join("\n\n");
  return joined || null;
}

function authorName(value: YamlValue): string | null {
  if (typeof value === "string") return markdownPlain(value) || null;
  if (Array.isArray(value)) return null;
  const name = value.name ?? value.literal;
  if (typeof name === "string") return markdownPlain(name) || null;
  if (name && !Array.isArray(name) && typeof name === "object") {
    const parts = [name.given, name.family].filter((part): part is string => typeof part === "string");
    return parts.length > 0 ? parts.join(" ") : scalar(name.literal);
  }
  const parts = [value.given, value.family].filter((part): part is string => typeof part === "string");
  return parts.length > 0 ? parts.join(" ") : null;
}

function asList(value: YamlValue | undefined): YamlValue[] {
  if (Array.isArray(value)) return value;
  return value === undefined ? [] : [value];
}

function readMetadata(front: FrontMatter | null): SubmissionMetadata {
  const metadata = emptyMetadata();
  if (!front) return metadata;
  const { values } = front;
  const title = scalar(values.title);
  metadata.title = title ? markdownPlain(title) || null : null;
  const authors = values.author ?? values.authors;
  metadata.authors = asList(authors).map(authorName).filter((name): name is string => !!name);
  const abstract = scalar(values.abstract);
  metadata.abstract = abstract ? paragraphs(abstract) : null;
  const keywords = values.keywords ?? values.keyword;
  if (Array.isArray(keywords)) {
    metadata.keywords = keywords.flatMap((keyword) => (typeof keyword === "string" ? [markdownPlain(keyword)] : [])).filter(Boolean);
  } else if (typeof keywords === "string") {
    metadata.keywords = keywords.split(/[,;]/u).map(markdownPlain).filter(Boolean);
  }
  const date = scalar(values.date)?.trim();
  metadata.date = date && !/^\\?today$/iu.test(date) ? date : null;
  return metadata;
}

function attributes(text: string | undefined): Attributes {
  if (!text) return { id: null, unnumbered: false };
  const id = /#([^\s{}]+)/u.exec(text)?.[1] ?? null;
  return { id, unnumbered: /(?:^|[\s{])(?:-|\.unnumbered)(?=[\s}]|$)/u.test(text) };
}

function trailingBraces(text: string): { index: number; group: string } | null {
  const end = text.trimEnd().length;
  if (text[end - 1] !== "}") return null;
  let open = end - 2;
  while (open >= 0 && text[open] !== "{" && text[open] !== "}") open -= 1;
  if (open < 0 || text[open] !== "{") return null;
  return { index: spaceRunStart(text, open), group: text.slice(open, end) };
}

function trailingAttributes(text: string): { text: string; attributes: Attributes } {
  const braces = trailingBraces(text);
  if (!braces || !/[#.-]/u.test(braces.group)) return { text, attributes: { id: null, unnumbered: false } };
  return { text: text.slice(0, braces.index), attributes: attributes(braces.group) };
}

function labelKind(id: string, fallback: LabelEntry["kind"]): LabelEntry["kind"] {
  if (id.startsWith("fig:")) return "figure";
  if (id.startsWith("tbl:") || id.startsWith("tab:")) return "table";
  if (id.startsWith("eq:")) return "equation";
  if (id.startsWith("sec:")) return "heading";
  return fallback;
}

function blankRun(text: string): string {
  return " ".repeat(text.length);
}

function maskInline(line: string): string {
  return line
    .replaceAll(/(`+)[^`]*?\1/gu, blankRun)
    .replaceAll(/\]\([^)]*\)/gu, (whole) => `]${blankRun(whole.slice(1))}`)
    .replaceAll(/<[a-z][a-z0-9+.-]*:[^>\s]*>/giu, blankRun)
    .replaceAll(/\b[a-z][a-z0-9+.-]*:\/\/\S+/giu, blankRun)
    .replaceAll(/(?<![\\$])\$(?!\$)(?:\\.|[^$\\\n])+\$(?!\$)/gu, blankRun);
}

function fenceMarker(line: string): Fence | null {
  const match = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
  return match ? { char: match[1][0], length: match[1].length } : null;
}

function closesFence(line: string, fence: Fence): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})\s*$/u.exec(line);
  return !!match && match[1].startsWith(fence.char) && match[1].length >= fence.length;
}

function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim() === "";
}

function declaredBibliographies(front: FrontMatter | null, mainDoc: string): string[] {
  const raw = asList(front?.values.bibliography);
  const dir = mainDoc.includes("/") ? mainDoc.slice(0, mainDoc.lastIndexOf("/")) : "";
  return raw
    .flatMap((item) => (typeof item === "string" ? [item.trim()] : []))
    .filter((path) => path && !/^[a-z][a-z0-9+.-]*:/iu.test(path) && !path.startsWith("/"))
    .map((path) => {
      const joined = dir ? `${dir}/${path.replace(/^\.\//u, "")}` : path.replace(/^\.\//u, "");
      const parts: string[] = [];
      for (const part of joined.split("/")) {
        if (part === "..") parts.pop();
        else if (part && part !== ".") parts.push(part);
      }
      return parts.join("/");
    });
}

function yamlReferenceIds(text: string): string[] {
  const ids: string[] = [];
  let searched = -1;
  let resume = 0;
  for (let index = 0; index <= text.length; index += 1) {
    const lineStart = index === 0 || LINE_BREAKS.has(text[index - 1]);
    if (!lineStart || index < resume || index <= searched) continue;
    searched = skipSpaces(text, index);
    YAML_REFERENCE_ID.lastIndex = searched;
    const match = YAML_REFERENCE_ID.exec(text);
    if (match) {
      ids.push(match[1]);
      resume = YAML_REFERENCE_ID.lastIndex;
    }
  }
  return ids;
}

function bibliographyFileKeys(path: string, text: string): string[] {
  if (/\.json$/iu.test(path)) return [...text.matchAll(/"id"\s*:\s*"([^"]+)"/gu)].map((match) => match[1]);
  if (/\.ya?ml$/iu.test(path)) return yamlReferenceIds(text);
  return bibtexKeys(text);
}

function inlineReferenceIds(front: FrontMatter | null): string[] {
  const references = front?.values.references;
  if (!Array.isArray(references)) return [];
  return references.flatMap((reference) =>
    reference && typeof reference === "object" && !Array.isArray(reference) && typeof reference.id === "string" ? [reference.id] : [],
  );
}

function bibliographyKeys(mainDoc: string, front: FrontMatter | null, texts: Readonly<Record<string, string>>): Set<string> | null {
  const keys = new Set<string>();
  for (const path of declaredBibliographies(front, mainDoc)) {
    const text = texts[path];
    if (text === undefined) return null;
    for (const key of bibliographyFileKeys(path, text)) keys.add(key);
  }
  for (const [path, text] of Object.entries(texts)) {
    if (/\.bib$/iu.test(path)) for (const key of bibtexKeys(text)) keys.add(key);
  }
  for (const id of inlineReferenceIds(front)) keys.add(id);
  return keys;
}

export function missingMarkdownSources(mainDoc: string, texts: Readonly<Record<string, string>>): string[] {
  const text = texts[mainDoc];
  if (text === undefined) return [mainDoc];
  return declaredBibliographies(parseFrontMatter(text), mainDoc).filter((path) => texts[path] === undefined);
}

function captionText(line: string): string | null {
  const start = skipSpaces(line, 0);
  const named = line.startsWith("Table:", start) || line.startsWith("table:", start);
  const colon = named ? start + 5 : start;
  if (line[colon] !== ":") return null;
  const body = skipSpaces(line, colon + 1);
  if (body === colon + 1) return null;
  const text = line.slice(body);
  return [...text].some((character) => LINE_BREAKS.has(character)) ? null : text;
}

function isPipeDelimiter(line: string): boolean {
  const trimmed = line.trim();
  let cells = trimmed.split("|");
  if (trimmed.startsWith("|")) cells = cells.slice(1);
  if (trimmed.endsWith("|") && cells.length > 0) cells = cells.slice(0, -1);
  return cells.length > 0 && cells.every((cell) => DELIMITER_CELL.test(cell.trim()));
}

function atxHeading(line: string): AtxHeading | null {
  let start = 0;
  while (start < 3 && line[start] === " ") start += 1;
  let end = start;
  while (line[end] === "#") end += 1;
  const level = end - start;
  if (level < 1 || level > 6) return null;
  if (end === line.length) return { level, text: undefined };
  if (line[end] !== " " && line[end] !== "\t") return null;
  const rest = line.slice(end);
  if ([...rest].some((character) => LINE_BREAKS.has(character))) return null;
  let from = 0;
  while (rest[from] === " " || rest[from] === "\t") from += 1;
  let to = rest.length;
  while (to > from && (rest[to - 1] === " " || rest[to - 1] === "\t")) to -= 1;
  return { level, text: rest.slice(from, to) };
}

function closingHashesRemoved(text: string): string {
  const end = text.trimEnd().length;
  let hashes = end;
  while (hashes > 0 && text[hashes - 1] === "#") hashes -= 1;
  if (hashes === end) return text;
  if (hashes === 0) return "";
  const start = spaceRunStart(text, hashes);
  return start < hashes ? text.slice(0, start) : text;
}

function nextBracket(text: string, from: number): number {
  for (let index = from; index < text.length; index += 1) {
    if (text[index] === "[" || text[index] === "]") return index;
  }
  return -1;
}

function imageAltEnd(text: string, from: number): number {
  let index = from;
  while (index < text.length) {
    const character = text[index];
    if (character === "]") return index;
    if (character === "[") {
      const close = nextBracket(text, index + 1);
      if (close < 0 || text[close] !== "]") return -1;
      index = close + 1;
    } else {
      index += 1;
    }
  }
  return -1;
}

function closingParen(text: string, from: number): number {
  const at = skipSpaces(text, from);
  return text[at] === ")" ? at + 1 : -1;
}

function titledTarget(text: string, at: number): { end: number; title: string } | null {
  const quote = text[at];
  if (quote !== '"' && quote !== "'") return null;
  const close = text.indexOf(quote, at + 1);
  if (close < 0) return null;
  const end = closingParen(text, close + 1);
  return end < 0 ? null : { end, title: text.slice(at + 1, close) };
}

function isUrlCharacter(character: string): boolean {
  return character !== ")" && character !== ">" && !isSpace(character);
}

function imageTarget(text: string, open: number): { end: number; title: string | undefined } | null {
  const start = skipSpaces(text, open);
  let cursor = text[start] === "<" ? start + 1 : start;
  while (cursor < text.length && isUrlCharacter(text[cursor])) cursor += 1;
  if (text[cursor] === ">") cursor += 1;
  const titled = isSpace(text[cursor]) ? titledTarget(text, skipSpaces(text, cursor)) : null;
  if (titled) return titled;
  const end = closingParen(text, cursor);
  if (end >= 0) return { end, title: undefined };
  return start > open ? titledTarget(text, start) : null;
}

function braceGroupEnd(text: string, at: number): number {
  if (text[at] !== "{") return -1;
  for (let index = at + 1; index < text.length; index += 1) {
    if (text[index] === "}") return index + 1;
    if (text[index] === "{") return -1;
  }
  return -1;
}

function imageAt(text: string, start: number): ImageMatch | null {
  const altEnd = imageAltEnd(text, start + 2);
  if (altEnd < 0 || text[altEnd + 1] !== "(") return null;
  const target = imageTarget(text, altEnd + 2);
  if (!target) return null;
  const attributesEnd = braceGroupEnd(text, target.end);
  return {
    index: start,
    text: text.slice(start, attributesEnd < 0 ? target.end : attributesEnd),
    alt: text.slice(start + 2, altEnd),
    title: target.title,
    attributes: attributesEnd < 0 ? undefined : text.slice(target.end, attributesEnd),
  };
}

function findImages(text: string): ImageMatch[] {
  const images: ImageMatch[] = [];
  let start = text.indexOf("![");
  while (start >= 0) {
    const image = imageAt(text, start);
    if (image) images.push(image);
    start = text.indexOf("![", image ? start + image.text.length : start + 1);
  }
  return images;
}

function blankImages(text: string): string {
  let out = "";
  let last = 0;
  for (const image of findImages(text)) {
    out += text.slice(last, image.index) + blankRun(image.text);
    last = image.index + image.text.length;
  }
  return out + text.slice(last);
}

function captionNear(lines: readonly string[], first: number, last: number): { line: number; text: string } | null {
  const candidates = [last + 1, last + 2, first - 1, first - 2];
  for (const index of candidates) {
    const text = lines[index];
    if (text === undefined) continue;
    const between = index > last ? lines.slice(last + 1, index) : lines.slice(index + 1, first);
    if (!between.every((line) => isBlank(line))) continue;
    const caption = captionText(text);
    if (caption !== null) return { line: index, text: caption };
  }
  return null;
}

function tableEnd(lines: readonly string[], start: number, grid: boolean): number {
  let index = start;
  while (index + 1 < lines.length && !isBlank(lines[index + 1])) {
    const next = lines[index + 1];
    if (grid ? !/^\s*[+|]/u.test(next) : !next.includes("|")) break;
    index += 1;
  }
  return index;
}

class MarkdownScan {
  readonly insights = emptyInsights();
  readonly cites: { key: string; location: SourceLocation }[] = [];
  private readonly labelKinds = new Map<string, LabelEntry["kind"]>();
  private entryIndex = 0;
  private fence: Fence | null = null;
  private inComment = false;
  private math: MathBlock | null = null;
  private raw: RawBlock | null = null;

  constructor(
    private readonly mainDoc: string,
    private readonly lines: readonly string[],
  ) {}

  scan(start: number): void {
    let index = start;
    while (index < this.lines.length) index = this.line(index) + 1;
  }

  private at(index: number, column = 1): SourceLocation {
    return { path: this.mainDoc, line: index + 1, column };
  }

  private addLabel(id: string | null, kind: LabelEntry["kind"], location: SourceLocation): void {
    if (!id || this.labelKinds.has(id)) return;
    const resolved = labelKind(id, kind);
    this.labelKinds.set(id, resolved);
    this.insights.labels.push({ name: id, kind: resolved, location });
  }

  private addEntry(kind: InsightEntryKind, entry: Omit<InsightEntry, "id" | "kind" | "figureKind" | "page" | "number">): void {
    this.entryIndex += 1;
    const full: InsightEntry = {
      id: `${kind}-${this.entryIndex}`,
      kind,
      figureKind: kind === "figure" || kind === "table" ? kind : null,
      page: null,
      number: null,
      ...entry,
    };
    const { insights } = this;
    const target = { heading: insights.headings, figure: insights.figures, table: insights.tables, equation: insights.equations }[kind];
    target.push(full);
  }

  private addTable(first: number, last: number): void {
    const caption = captionNear(this.lines, first, last);
    const parsed = caption ? trailingAttributes(caption.text) : null;
    this.addEntry("table", {
      text: parsed ? markdownPlain(parsed.text) : "",
      label: parsed?.attributes.id ?? null,
      level: null,
      numbered: !!parsed && markdownPlain(parsed.text) !== "",
      location: this.at(first),
    });
    if (caption && parsed?.attributes.id) {
      this.addLabel(parsed.attributes.id, "table", this.at(caption.line, this.lines[caption.line].indexOf("{#") + 1));
    }
  }

  private collectCitations(source: string, index: number): void {
    for (const match of source.matchAll(CITATION)) {
      const raw = match[1];
      const key = raw.startsWith("{") ? raw.slice(1, -1) : trimTrailing(raw, ".:,;!?/-");
      if (!key || CROSSREF_PREFIX.test(key)) continue;
      this.cites.push({ key, location: this.at(index, match.index + match[0].indexOf("@") + 1) });
    }
  }

  private finishRaw(block: RawBlock): void {
    const body = block.body.join(" ");
    const label = /\\label\s*\{([^{}]+)\}/u.exec(body)?.[1].trim() ?? null;
    this.addEntry("equation", {
      text: body.replaceAll(/\\label\s*\{[^{}]*\}/gu, " ").replaceAll(/\s+/gu, " ").trim(),
      label,
      level: null,
      numbered: !block.starred,
      location: this.at(block.start),
    });
    this.addLabel(label, "equation", this.at(block.start));
  }

  private line(index: number): number {
    const line = this.lines[index];
    if (this.fence) {
      if (closesFence(line, this.fence)) this.fence = null;
      return index;
    }
    const opening = fenceMarker(line);
    if (opening && !this.math && !this.raw) {
      this.fence = opening;
      return index;
    }
    this.collectTodo(line, index);
    const visible = this.visibleText(line);
    if (visible === null) return index;
    if (this.math) {
      this.continueMath(this.math, visible, index);
      return index;
    }
    if (this.raw) {
      this.continueRaw(this.raw, visible);
      return index;
    }
    return this.content(visible, index);
  }

  private collectTodo(line: string, index: number): void {
    const todo = TODO_MARKER.exec(line);
    if (!todo || line[todo.index - 1] === "\\") return;
    const marked = line.slice(todo.index);
    const commentEnd = htmlCommentEnd(marked);
    this.insights.todos.push({
      text: todoText(commentEnd ? marked.slice(0, commentEnd.index).trimEnd() : marked),
      location: this.at(index, todo.index + 1),
    });
  }

  private visibleText(line: string): string | null {
    let visible = line;
    if (this.inComment) {
      const end = htmlCommentEnd(line);
      if (!end) return null;
      this.inComment = false;
      const after = end.index + end.length;
      visible = blankRun(line.slice(0, after)) + line.slice(after);
    }
    visible = visible.replaceAll(/<!--[\s\S]*?--!?>/gu, blankRun);
    const open = visible.indexOf("<!--");
    if (open < 0) return visible;
    this.inComment = true;
    return visible.slice(0, open) + blankRun(visible.slice(open));
  }

  private continueMath(math: MathBlock, visible: string, index: number): void {
    const close = visible.indexOf("$$");
    if (close < 0) {
      math.body.push(visible);
      return;
    }
    math.body.push(visible.slice(0, close));
    const { attributes: attrs } = trailingAttributes(visible.slice(close + 2));
    this.addEntry("equation", {
      text: math.body.join(" ").replaceAll(/\s+/gu, " ").trim(),
      label: attrs.id,
      level: null,
      numbered: false,
      location: this.at(math.start, math.column),
    });
    this.addLabel(attrs.id, "equation", this.at(index, visible.indexOf("{#", close) + 1));
    this.math = null;
  }

  private continueRaw(raw: RawBlock, visible: string): void {
    const end = new RegExp(String.raw`\\end\s*\{${raw.name}\*?\}`, "u").exec(visible);
    raw.body.push(end ? visible.slice(0, end.index) : visible);
    if (!end) return;
    this.finishRaw(raw);
    this.raw = null;
  }

  private content(visible: string, index: number): number {
    const masked = maskInline(visible);
    const next = this.lines[index + 1];
    const atx = atxHeading(visible);
    if (atx) {
      this.atxHeading(visible, atx, index);
    } else {
      const consumed = this.blockStructure(visible, masked, index, next);
      if (consumed !== null) return consumed;
    }
    if (this.rawEquation(visible, index) || this.displayMath(visible, masked, index)) return index;
    this.divLabel(visible, index);
    this.images(visible, index, next);
    this.collectCitations(blankImages(masked), index);
    return index;
  }

  private atxHeading(visible: string, atx: AtxHeading, index: number): void {
    const { text: title, attributes: attrs } = trailingAttributes(closingHashesRemoved(atx.text ?? ""));
    this.addEntry("heading", {
      text: markdownPlain(title),
      label: attrs.id,
      level: atx.level,
      numbered: !attrs.unnumbered,
      location: this.at(index, visible.indexOf("#") + 1),
    });
    this.addLabel(attrs.id, "heading", this.at(index, visible.indexOf("{#") + 1));
  }

  private blockStructure(visible: string, masked: string, index: number, next: string | undefined): number | null {
    if (!isBlank(visible) && next !== undefined && SETEXT.test(next) && isBlank(this.lines[index - 1]) && !visible.includes("|")) {
      this.setextHeading(visible, masked, index, next);
      return index + 1;
    }
    if (visible.includes("|") && next !== undefined && isPipeDelimiter(next) && next.includes("-")) return this.table(index, index + 1, false);
    if (GRID_BORDER.test(visible)) return this.table(index, index, true);
    return null;
  }

  private setextHeading(visible: string, masked: string, index: number, next: string): void {
    const { text: title, attributes: attrs } = trailingAttributes(visible.trim());
    this.addEntry("heading", {
      text: markdownPlain(title),
      label: attrs.id,
      level: next.trim().startsWith("=") ? 1 : 2,
      numbered: !attrs.unnumbered,
      location: this.at(index, visible.length - visible.trimStart().length + 1),
    });
    this.addLabel(attrs.id, "heading", this.at(index, visible.indexOf("{#") + 1));
    this.collectCitations(masked, index);
  }

  private table(first: number, from: number, grid: boolean): number {
    const last = tableEnd(this.lines, from, grid);
    for (let row = first; row <= last; row += 1) this.collectCitations(maskInline(this.lines[row]), row);
    this.addTable(first, last);
    return last;
  }

  private rawEquation(visible: string, index: number): boolean {
    const rawStart = RAW_EQUATION.exec(visible);
    if (!rawStart) return false;
    const rest = visible.slice(rawStart.index + rawStart[0].length);
    const end = new RegExp(String.raw`\\end\s*\{${rawStart[1]}\*?\}`, "u").exec(rest);
    const block = { start: index, name: rawStart[1], starred: rawStart[2] === "*", body: [end ? rest.slice(0, end.index) : rest] };
    if (end) this.finishRaw(block);
    else this.raw = block;
    return true;
  }

  private displayMath(visible: string, masked: string, index: number): boolean {
    const dollars = masked.indexOf("$$");
    if (dollars < 0) return false;
    const close = masked.indexOf("$$", dollars + 2);
    if (close < 0) {
      this.math = { start: index, column: dollars + 1, body: [visible.slice(dollars + 2)] };
      this.collectCitations(masked.slice(0, dollars), index);
      return true;
    }
    const { attributes: attrs } = trailingAttributes(visible.slice(close + 2));
    this.addEntry("equation", {
      text: visible.slice(dollars + 2, close).replaceAll(/\s+/gu, " ").trim(),
      label: attrs.id,
      level: null,
      numbered: false,
      location: this.at(index, dollars + 1),
    });
    this.addLabel(attrs.id, "equation", this.at(index, visible.indexOf("{#", close) + 1));
    this.collectCitations(masked.slice(0, dollars) + blankRun(masked.slice(dollars)), index);
    return true;
  }

  private divLabel(visible: string, index: number): void {
    const div = /^\s*:{3,}\s*\{([^{}]*)\}/u.exec(visible);
    if (!div) return;
    const { id } = attributes(`{${div[1]}}`);
    this.addLabel(id, "other", this.at(index, visible.indexOf("#") + 1));
  }

  private images(visible: string, index: number, next: string | undefined): void {
    const standalone = /^\s*!\[/u.test(visible) && isBlank(this.lines[index - 1]) && isBlank(next);
    if (!standalone) return;
    for (const image of findImages(visible)) {
      if (visible.trim() !== image.text.trim()) continue;
      const attrs = attributes(image.attributes);
      this.addEntry("figure", {
        text: markdownPlain(image.alt) || markdownPlain(image.title ?? ""),
        label: attrs.id,
        level: null,
        numbered: markdownPlain(image.alt) !== "",
        location: this.at(index, image.index + 1),
      });
      this.addLabel(attrs.id, "figure", this.at(index, image.index + image.text.length - (image.attributes?.length ?? 0) + 1));
    }
  }
}

export function buildMarkdownInsights({ mainDoc, texts }: MarkdownInsightsInput): DocumentInsightsBase {
  const text = texts[mainDoc]?.replaceAll("\r\n", "\n");
  if (text === undefined) return emptyInsights();
  const front = parseFrontMatter(text);
  const scan = new MarkdownScan(mainDoc, text.split("\n"));
  scan.insights.metadata = readMetadata(front);
  scan.scan(front ? front.endLine : 0);
  scan.insights.citations = citationList(scan.cites, bibliographyKeys(mainDoc, front, texts));
  return scan.insights;
}
