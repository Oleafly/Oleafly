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

const CROSSREF_PREFIX = /^(?:fig|tbl|eq|sec|lst|thm|lem|def|cor|prop|tab):/u;
const CITATION = /(?<![\p{L}\p{N}_])-?@(\{[^{}\s]+\}|[\p{L}\p{N}_][\p{L}\p{N}_:.#$%&+?<>~/-]*)/gu;
const IMAGE = /!\[((?:[^[\]]|\[[^[\]]*\])*)\]\(\s*<?([^)\s>]*)>?(?:\s+(?:"([^"]*)"|'([^']*)'))?\s*\)(\{[^{}]*\})?/gu;
const PIPE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/u;
const GRID_BORDER = /^\s*\+(?:[-=:]+\+)+\s*$/u;
const SETEXT = /^ {0,3}(?:=+|-+)\s*$/u;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/u;
const CAPTION = /^\s*(?:Table|table)?:\s+(.*)$/u;
const RAW_EQUATION = /^\s*\\begin\s*\{(equation|align|gather|multline|flalign|alignat|eqnarray)(\*?)\}/u;

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
      .replaceAll("\\n", "\n")
      .replaceAll("\\t", "\t");
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

function blockScalar(lines: readonly YamlLine[], from: number, parentIndent: number, header: string): [string, number] {
  const folded = header.startsWith(">");
  const chomp = header.includes("-") ? "strip" : header.includes("+") ? "keep" : "clip";
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
  let text: string;
  if (folded) {
    text = collected
      .join("\n")
      .split(/\n{2,}/u)
      .map((paragraph) => paragraph.replaceAll("\n", " "))
      .join("\n");
  } else text = collected.join("\n");
  if (chomp !== "strip" && text) text += "\n";
  return [text, index];
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

function parseValue(lines: readonly YamlLine[], index: number, indent: number, rest: string): [YamlValue, number] {
  const value = stripComment(rest).trim();
  if (value.startsWith("|") || value.startsWith(">")) return blockScalar(lines, index + 1, indent, value);
  if (value === "") {
    const next = nextContent(lines, index + 1);
    const line = lines[next];
    if (!line) return ["", next];
    if (line.text.startsWith("- ") || line.text === "-") {
      if (line.indent >= indent) return parseSequence(lines, next, line.indent);
    } else if (line.indent > indent) return parseMapping(lines, next, line.indent);
    return ["", index + 1];
  }
  if (value.startsWith("[") || value.startsWith("{")) {
    let text = value;
    let cursor = index + 1;
    const close = value.startsWith("[") ? "]" : "}";
    while (!text.endsWith(close) && cursor < lines.length && lines[cursor].indent > indent) {
      text += ` ${stripComment(lines[cursor].text).trim()}`;
      cursor += 1;
    }
    return [flowValue(text), cursor];
  }
  if ((value.startsWith('"') || value.startsWith("'")) && !(value.length > 1 && value.endsWith(value[0]))) {
    let text = value;
    let cursor = index + 1;
    while (cursor < lines.length && !text.endsWith(value[0])) {
      text += ` ${lines[cursor].text}`;
      cursor += 1;
    }
    return [unquote(text), cursor];
  }
  if (value.startsWith('"') || value.startsWith("'")) return [unquote(value), index + 1];
  return plainScalar(lines, index + 1, indent, value);
}

function keyValue(text: string): [string, string] | null {
  const match = /^("[^"]*"|'[^']*'|[^\s:#"'][^:]*?)\s*:(?:\s+(.*)|$)/u.exec(text);
  return match ? [unquote(match[1]), match[2] ?? ""] : null;
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
    const text = raw.replace(/\s+$/u, "");
    const trimmed = text.trimStart();
    return { indent: text.length - trimmed.length, text: trimmed, raw: text };
  });
  return { values: parseMapping(body, 0, 0)[0], endLine: close + 1 };
}

function scalar(value: YamlValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function markdownPlain(text: string): string {
  return text
    .replaceAll(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
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

function readMetadata(front: FrontMatter | null): SubmissionMetadata {
  const metadata = emptyMetadata();
  if (!front) return metadata;
  const { values } = front;
  const title = scalar(values.title);
  metadata.title = title ? markdownPlain(title) || null : null;
  const authors = values.author ?? values.authors;
  const list = Array.isArray(authors) ? authors : authors === undefined ? [] : [authors];
  metadata.authors = list.map(authorName).filter((name): name is string => !!name);
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

function trailingAttributes(text: string): { text: string; attributes: Attributes } {
  const match = /\s*(\{[^{}]*\})\s*$/u.exec(text);
  if (!match || !/[#.-]/u.test(match[1])) return { text, attributes: { id: null, unnumbered: false } };
  return { text: text.slice(0, match.index), attributes: attributes(match[1]) };
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
  return !!match && match[1][0] === fence.char && match[1].length >= fence.length;
}

function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim() === "";
}

function declaredBibliographies(front: FrontMatter | null, mainDoc: string): string[] {
  const value = front?.values.bibliography;
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
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

function bibliographyFileKeys(path: string, text: string): string[] {
  if (/\.json$/iu.test(path)) return [...text.matchAll(/"id"\s*:\s*"([^"]+)"/gu)].map((match) => match[1]);
  if (/\.ya?ml$/iu.test(path)) return [...text.matchAll(/^\s*-?\s*id\s*:\s*["']?([^"'\s#]+)/gmu)].map((match) => match[1]);
  return bibtexKeys(text);
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
  const references = front?.values.references;
  if (Array.isArray(references)) {
    for (const reference of references) {
      if (reference && typeof reference === "object" && !Array.isArray(reference) && typeof reference.id === "string") keys.add(reference.id);
    }
  }
  return keys;
}

export function missingMarkdownSources(mainDoc: string, texts: Readonly<Record<string, string>>): string[] {
  const text = texts[mainDoc];
  if (text === undefined) return [mainDoc];
  return declaredBibliographies(parseFrontMatter(text), mainDoc).filter((path) => texts[path] === undefined);
}

function captionNear(lines: readonly string[], first: number, last: number): { line: number; text: string } | null {
  const candidates = [last + 1, last + 2, first - 1, first - 2];
  for (const index of candidates) {
    const text = lines[index];
    if (text === undefined) continue;
    const between = index > last ? lines.slice(last + 1, index) : lines.slice(index + 1, first);
    if (!between.every((line) => isBlank(line))) continue;
    const match = CAPTION.exec(text);
    if (match) return { line: index, text: match[1] };
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

export function buildMarkdownInsights({ mainDoc, texts }: MarkdownInsightsInput): DocumentInsightsBase {
  const text = texts[mainDoc];
  if (text === undefined) return emptyInsights();
  const insights = emptyInsights();
  const front = parseFrontMatter(text);
  insights.metadata = readMetadata(front);
  const lines = text.split("\n");
  const at = (index: number, column = 1): SourceLocation => ({ path: mainDoc, line: index + 1, column });
  const cites: { key: string; location: SourceLocation }[] = [];
  const labelKinds = new Map<string, LabelEntry["kind"]>();
  let entryIndex = 0;
  const addLabel = (id: string | null, kind: LabelEntry["kind"], location: SourceLocation) => {
    if (!id || labelKinds.has(id)) return;
    const resolved = labelKind(id, kind);
    labelKinds.set(id, resolved);
    insights.labels.push({ name: id, kind: resolved, location });
  };
  const addEntry = (kind: InsightEntryKind, entry: Omit<InsightEntry, "id" | "kind" | "figureKind" | "page" | "number">) => {
    entryIndex += 1;
    const full: InsightEntry = {
      id: `${kind}-${entryIndex}`,
      kind,
      figureKind: kind === "figure" || kind === "table" ? kind : null,
      page: null,
      number: null,
      ...entry,
    };
    const target = { heading: insights.headings, figure: insights.figures, table: insights.tables, equation: insights.equations }[kind];
    target.push(full);
  };
  const addTable = (first: number, last: number) => {
    const caption = captionNear(lines, first, last);
    const parsed = caption ? trailingAttributes(caption.text) : null;
    const location = at(first);
    addEntry("table", {
      text: parsed ? markdownPlain(parsed.text) : "",
      label: parsed?.attributes.id ?? null,
      level: null,
      numbered: !!parsed && markdownPlain(parsed.text) !== "",
      location,
    });
    if (caption && parsed?.attributes.id) addLabel(parsed.attributes.id, "table", at(caption.line, lines[caption.line].indexOf("{#") + 1));
  };

  const collectCitations = (source: string, index: number) => {
    for (const match of source.matchAll(CITATION)) {
      let key = match[1];
      if (key.startsWith("{")) key = key.slice(1, -1);
      else key = key.replace(/[.:,;!?/-]+$/u, "");
      if (!key || CROSSREF_PREFIX.test(key)) continue;
      cites.push({ key, location: at(index, match.index + match[0].indexOf("@") + 1) });
    }
  };
  const finishRaw = (block: { start: number; starred: boolean; body: string[] }) => {
    const body = block.body.join(" ");
    const label = /\\label\s*\{([^{}]+)\}/u.exec(body)?.[1].trim() ?? null;
    addEntry("equation", {
      text: body.replaceAll(/\\label\s*\{[^{}]*\}/gu, " ").replaceAll(/\s+/gu, " ").trim(),
      label,
      level: null,
      numbered: !block.starred,
      location: at(block.start),
    });
    addLabel(label, "equation", at(block.start));
  };

  let fence: Fence | null = null;
  let inComment = false;
  let math: { start: number; column: number; body: string[] } | null = null;
  let raw: { start: number; name: string; starred: boolean; body: string[] } | null = null;
  const start = front ? front.endLine : 0;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const opening = fenceMarker(line);
    if (opening && !math && !raw) {
      fence = opening;
      continue;
    }
    const todo = TODO_MARKER.exec(line);
    if (todo && line[todo.index - 1] !== "\\") {
      insights.todos.push({ text: todoText(line.slice(todo.index).replace(/\s*-->.*$/u, "")), location: at(index, todo.index + 1) });
    }
    let visible = line;
    if (inComment) {
      const end = line.indexOf("-->");
      if (end < 0) continue;
      inComment = false;
      visible = blankRun(line.slice(0, end + 3)) + line.slice(end + 3);
    }
    visible = visible.replaceAll(/<!--[\s\S]*?-->/gu, blankRun);
    const open = visible.indexOf("<!--");
    if (open >= 0) {
      inComment = true;
      visible = visible.slice(0, open) + blankRun(visible.slice(open));
    }
    if (math) {
      const close = visible.indexOf("$$");
      if (close < 0) {
        math.body.push(visible);
        continue;
      }
      math.body.push(visible.slice(0, close));
      const { attributes: attrs } = trailingAttributes(visible.slice(close + 2));
      addEntry("equation", {
        text: math.body.join(" ").replaceAll(/\s+/gu, " ").trim(),
        label: attrs.id,
        level: null,
        numbered: false,
        location: at(math.start, math.column),
      });
      addLabel(attrs.id, "equation", at(index, visible.indexOf("{#", close) + 1));
      math = null;
      continue;
    }
    if (raw) {
      const end = new RegExp(String.raw`\\end\s*\{${raw.name}\*?\}`, "u").exec(visible);
      raw.body.push(end ? visible.slice(0, end.index) : visible);
      if (!end) continue;
      finishRaw(raw);
      raw = null;
      continue;
    }

    const masked = maskInline(visible);
    const atx = ATX.exec(visible);
    const next = lines[index + 1];
    if (atx) {
      const { text: title, attributes: attrs } = trailingAttributes((atx[2] ?? "").replace(/(?:^|\s+)#+\s*$/u, ""));
      addEntry("heading", {
        text: markdownPlain(title),
        label: attrs.id,
        level: atx[1].length,
        numbered: !attrs.unnumbered,
        location: at(index, visible.indexOf("#") + 1),
      });
      addLabel(attrs.id, "heading", at(index, visible.indexOf("{#") + 1));
    } else if (!isBlank(visible) && next !== undefined && SETEXT.test(next) && isBlank(lines[index - 1]) && !visible.includes("|")) {
      const { text: title, attributes: attrs } = trailingAttributes(visible.trim());
      addEntry("heading", {
        text: markdownPlain(title),
        label: attrs.id,
        level: next.trim().startsWith("=") ? 1 : 2,
        numbered: !attrs.unnumbered,
        location: at(index, visible.length - visible.trimStart().length + 1),
      });
      addLabel(attrs.id, "heading", at(index, visible.indexOf("{#") + 1));
      collectCitations(masked, index);
      index += 1;
      continue;
    } else if (visible.includes("|") && next !== undefined && PIPE_DELIMITER.test(next) && next.includes("-")) {
      const last = tableEnd(lines, index + 1, false);
      for (let row = index; row <= last; row += 1) collectCitations(maskInline(lines[row]), row);
      addTable(index, last);
      index = last;
      continue;
    } else if (GRID_BORDER.test(visible)) {
      const last = tableEnd(lines, index, true);
      for (let row = index; row <= last; row += 1) collectCitations(maskInline(lines[row]), row);
      addTable(index, last);
      index = last;
      continue;
    }

    const rawStart = RAW_EQUATION.exec(visible);
    if (rawStart) {
      const rest = visible.slice(rawStart.index + rawStart[0].length);
      const end = new RegExp(String.raw`\\end\s*\{${rawStart[1]}\*?\}`, "u").exec(rest);
      const block = { start: index, name: rawStart[1], starred: rawStart[2] === "*", body: [end ? rest.slice(0, end.index) : rest] };
      if (end) finishRaw(block);
      else raw = block;
      continue;
    }

    const dollars = masked.indexOf("$$");
    if (dollars >= 0) {
      const close = masked.indexOf("$$", dollars + 2);
      if (close < 0) {
        math = { start: index, column: dollars + 1, body: [visible.slice(dollars + 2)] };
        collectCitations(masked.slice(0, dollars), index);
        continue;
      }
      const { attributes: attrs } = trailingAttributes(visible.slice(close + 2));
      addEntry("equation", {
        text: visible.slice(dollars + 2, close).replaceAll(/\s+/gu, " ").trim(),
        label: attrs.id,
        level: null,
        numbered: false,
        location: at(index, dollars + 1),
      });
      addLabel(attrs.id, "equation", at(index, visible.indexOf("{#", close) + 1));
      collectCitations(masked.slice(0, dollars) + blankRun(masked.slice(dollars)), index);
      continue;
    }

    const div = /^\s*:{3,}\s*\{([^{}]*)\}/u.exec(visible);
    if (div) {
      const { id } = attributes(`{${div[1]}}`);
      addLabel(id, "other", at(index, visible.indexOf("#") + 1));
    }

    const standalone = /^\s*!\[/u.test(visible) && isBlank(lines[index - 1]) && isBlank(next);
    for (const image of visible.matchAll(IMAGE)) {
      if (!standalone || visible.trim() !== image[0].trim()) continue;
      const attrs = attributes(image[5]);
      const caption = markdownPlain(image[1]) || markdownPlain(image[3] ?? image[4] ?? "");
      addEntry("figure", {
        text: caption,
        label: attrs.id,
        level: null,
        numbered: markdownPlain(image[1]) !== "",
        location: at(index, image.index + 1),
      });
      addLabel(attrs.id, "figure", at(index, image.index + image[0].length - (image[5]?.length ?? 0) + 1));
    }
    collectCitations(masked.replaceAll(IMAGE, (whole) => blankRun(whole)), index);
  }

  insights.citations = citationList(cites, bibliographyKeys(mainDoc, front, texts));
  return insights;
}
