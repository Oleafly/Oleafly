import { bibtexTextToUnicode } from "@/lib/project-intelligence/bibtex-text";
import type { ParsedBib } from "./types";

export interface HayagrivaField {
  readonly name: string;
  readonly value: string;
  readonly from: number;
  readonly to: number;
}

export interface HayagrivaEntry {
  readonly key: string;
  readonly keyFrom: number;
  readonly keyTo: number;
  readonly from: number;
  readonly to: number;
  readonly isEntry: boolean;
  readonly type?: string;
  readonly title?: HayagrivaField;
  readonly author?: HayagrivaField;
  readonly authors: readonly string[];
  readonly date?: HayagrivaField;
  readonly doi?: string;
}

interface YamlLine {
  readonly text: string;
  readonly from: number;
  readonly indent: number;
  readonly blank: boolean;
}

interface MappingKey {
  readonly key: string;
  readonly keyFrom: number;
  readonly keyTo: number;
  readonly valueStart: number;
}

interface FieldBlock {
  readonly name: string;
  readonly inline: string;
  readonly lines: readonly YamlLine[];
  readonly from: number;
  readonly to: number;
}

const HAYAGRIVA_EXTENSION = /\.ya?ml$/i;

export function isHayagrivaPath(path: string): boolean {
  return HAYAGRIVA_EXTENSION.test(path);
}

function yamlLines(source: string): YamlLine[] {
  const lines: YamlLine[] = [];
  let from = 0;
  while (from <= source.length) {
    const newline = source.indexOf("\n", from);
    const end = newline < 0 ? source.length : newline;
    const text = source.slice(from, end).replace(/\r$/, "");
    let indent = 0;
    while (text[indent] === " " || text[indent] === "\t") indent += 1;
    const rest = text.slice(indent);
    lines.push({ text, from, indent, blank: rest.trim() === "" || rest.startsWith("#") });
    if (newline < 0) break;
    from = newline + 1;
  }
  return lines;
}

function lineEnd(line: YamlLine): number {
  return line.from + line.text.length;
}

function closingQuote(text: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < text.length) {
    const character = text[index];
    if (quote === '"' && character === "\\") {
      index += 2;
      continue;
    }
    if (character === quote) {
      if (quote === "'" && text[index + 1] === "'") {
        index += 2;
        continue;
      }
      return index;
    }
    index += 1;
  }
  return -1;
}

const DOUBLE_QUOTED_ESCAPES: Readonly<Record<string, string>> = {
  "\\": "\\",
  '"': '"',
  "/": "/",
  " ": " ",
  "0": "\0",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  "\t": "\t",
  N: "\u0085",
  _: "\u00a0",
  L: "\u2028",
  P: "\u2029",
};

const HEX_ESCAPE_LENGTHS: Readonly<Record<string, number>> = { x: 2, u: 4, U: 8 };

function decodeDoubleQuoted(body: string): string {
  let value = "";
  let index = 0;
  while (index < body.length) {
    const character = body[index];
    if (character !== "\\") {
      value += character;
      index += 1;
      continue;
    }
    const next = body[index + 1] ?? "";
    const hexLength = HEX_ESCAPE_LENGTHS[next];
    const hex = hexLength ? body.slice(index + 2, index + 2 + hexLength) : "";
    if (hexLength && hex.length === hexLength && /^[0-9a-f]+$/i.test(hex)) {
      const codePoint = Number.parseInt(hex, 16);
      value += codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : "\ufffd";
      index += 2 + hexLength;
    } else {
      value += DOUBLE_QUOTED_ESCAPES[next] ?? next;
      index += 2;
    }
  }
  return value;
}

function stripComment(text: string): string {
  let quote: string | null = null;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quote) {
      if (quote === '"' && character === "\\") index += 1;
      else if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "#" && (index === 0 || text[index - 1].trim() === "")) {
      return text.slice(0, index).trimEnd();
    }
  }
  return text.trimEnd();
}

function yamlScalar(raw: string): string {
  const text = raw.trim();
  const quote = text[0];
  if (quote === '"' || quote === "'") {
    const close = closingQuote(text, 0, quote);
    const body = text.slice(1, close < 0 ? text.length : close);
    return quote === '"' ? decodeDoubleQuoted(body) : body.replaceAll("''", "'");
  }
  return text;
}

function quotedMappingKey(text: string, start: number, quote: string): MappingKey | null {
  const close = closingQuote(text, start, quote);
  if (close < 0) return null;
  const key = yamlScalar(text.slice(start, close + 1));
  let after = close + 1;
  while (text[after] === " " || text[after] === "\t") after += 1;
  if (text[after] !== ":" || !key) return null;
  return { key, keyFrom: start + 1, keyTo: close, valueStart: after + 1 };
}

function plainKeyColon(text: string, start: number): number {
  for (let index = start; index < text.length; index++) {
    const next = text[index + 1];
    if (text[index] === ":" && (next === undefined || next.trim() === "")) return index;
    if (text[index] === "#" && index > start && text[index - 1].trim() === "") return -1;
  }
  return -1;
}

function plainMappingKey(text: string, start: number): MappingKey | null {
  const colon = plainKeyColon(text, start);
  if (colon < 0) return null;
  const key = text.slice(start, colon).trimEnd();
  if (!key) return null;
  return { key, keyFrom: start, keyTo: start + key.length, valueStart: colon + 1 };
}

function readMappingKey(text: string, start: number): MappingKey | null {
  const first = text[start];
  if (first === undefined || "-?[]{}#&*!|>%@`,".includes(first)) return null;
  if (first === '"' || first === "'") return quotedMappingKey(text, start, first);
  return plainMappingKey(text, start);
}

function splitFlow(body: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let index = 0; index < body.length; index++) {
    const character = body[index];
    if (quote) {
      if (quote === '"' && character === "\\") index += 1;
      else if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "[" || character === "{") {
      depth += 1;
    } else if (character === "]" || character === "}") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      items.push(body.slice(start, index).trim());
      start = index + 1;
    }
  }
  items.push(body.slice(start).trim());
  return items.filter(Boolean);
}

function flowBody(text: string, open: string, close: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(open) || !trimmed.endsWith(close)) return null;
  return trimmed.slice(1, -1);
}

function flowMap(text: string): Map<string, string> | null {
  const body = flowBody(text, "{", "}");
  if (body === null) return null;
  const map = new Map<string, string>();
  for (const item of splitFlow(body)) {
    const key = readMappingKey(item, 0);
    if (key) map.set(key.key, item.slice(key.valueStart).trim());
  }
  return map;
}

function personDisplay(name: string | undefined, given: string | undefined): string {
  const family = name ? yamlScalar(name) : "";
  const first = given ? yamlScalar(given) : "";
  return first && family ? `${family}, ${first}` : family || first;
}

function nestedLines(lines: readonly YamlLine[]): YamlLine[] {
  return lines.filter((line) => !line.blank);
}

function nestedValue(lines: readonly YamlLine[], name: string): string | undefined {
  const content = nestedLines(lines);
  const indent = content.reduce((lowest, line) => Math.min(lowest, line.indent), Number.POSITIVE_INFINITY);
  for (const line of content) {
    if (line.indent !== indent) continue;
    const key = readMappingKey(line.text, line.indent);
    if (key?.key === name) return yamlScalar(stripComment(line.text.slice(key.valueStart)));
  }
  return undefined;
}

function isBlockScalarIndicator(inline: string): boolean {
  return /^[|>][-+0-9]*$/.test(inline);
}

function scalarField(block: FieldBlock): string | undefined {
  if (isBlockScalarIndicator(block.inline)) {
    return nestedLines(block.lines).map((line) => line.text.trim()).join(" ");
  }
  if (block.inline.startsWith("{")) {
    const value = flowMap(block.inline)?.get("value");
    return value === undefined ? undefined : yamlScalar(value);
  }
  if (block.inline) return yamlScalar(block.inline);
  return nestedLines(block.lines).length ? nestedValue(block.lines, "value") : undefined;
}

function listItemPerson(item: string, rest: readonly YamlLine[]): string {
  const map = flowMap(item);
  if (map) return personDisplay(map.get("name"), map.get("given-name"));
  const key = readMappingKey(item, 0);
  if (!key && item) return yamlScalar(item);
  const fields = new Map<string, string>(key ? [[key.key, item.slice(key.valueStart).trim()]] : []);
  for (const line of rest) {
    const nested = readMappingKey(line.text, line.indent);
    if (nested) fields.set(nested.key, stripComment(line.text.slice(nested.valueStart)));
  }
  return personDisplay(fields.get("name"), fields.get("given-name"));
}

function peopleField(block: FieldBlock): string[] {
  const flow = flowBody(block.inline, "[", "]");
  if (flow !== null) return splitFlow(flow).map((item) => listItemPerson(item, [])).filter(Boolean);
  if (block.inline) return [listItemPerson(block.inline, [])].filter(Boolean);
  const content = nestedLines(block.lines);
  const people: string[] = [];
  for (let index = 0; index < content.length; index++) {
    const line = content[index];
    const rest = line.text.slice(line.indent);
    if (!rest.startsWith("- ") && rest !== "-") continue;
    const item = stripComment(rest.slice(1)).trim();
    const following: YamlLine[] = [];
    while (index + 1 < content.length && content[index + 1].indent > line.indent) {
      following.push(content[index + 1]);
      index += 1;
    }
    const person = listItemPerson(item, following);
    if (person) people.push(person);
  }
  return people;
}

function doiField(block: FieldBlock): string | undefined {
  if (block.inline.startsWith("{")) {
    const value = flowMap(block.inline)?.get("doi");
    return value === undefined ? undefined : yamlScalar(value);
  }
  if (block.inline) return undefined;
  return nestedLines(block.lines).length ? nestedValue(block.lines, "doi") : undefined;
}

function fieldBlocks(lines: readonly YamlLine[]): FieldBlock[] {
  const content = nestedLines(lines);
  if (content.length === 0) return [];
  const indent = content[0].indent;
  const blocks: FieldBlock[] = [];
  for (let index = 0; index < content.length; index++) {
    const line = content[index];
    if (line.indent !== indent) continue;
    const key = readMappingKey(line.text, line.indent);
    if (!key) continue;
    const nested: YamlLine[] = [];
    while (index + 1 < content.length) {
      const next = content[index + 1];
      const sequence = next.indent === indent && next.text.slice(next.indent).startsWith("-");
      if (next.indent <= indent && !sequence) break;
      nested.push(next);
      index += 1;
    }
    const last = nested.at(-1) ?? line;
    blocks.push({
      name: key.key,
      inline: stripComment(line.text.slice(key.valueStart)).trim(),
      lines: nested,
      from: line.from + line.indent,
      to: lineEnd(last),
    });
  }
  return blocks;
}

function field(block: FieldBlock | undefined, value: string | undefined): HayagrivaField | undefined {
  return block && value ? { name: block.name, value, from: block.from, to: block.to } : undefined;
}

function entryFromBlocks(
  key: MappingKey,
  line: YamlLine,
  blocks: readonly FieldBlock[],
  to: number,
): HayagrivaEntry {
  const byName = new Map(blocks.map((block) => [block.name, block]));
  const typeBlock = byName.get("type");
  const titleBlock = byName.get("title");
  const authorBlock = byName.get("author");
  const dateBlock = byName.get("date");
  const authors = authorBlock ? peopleField(authorBlock) : [];
  const serial = byName.get("serial-number");
  const legacyDoi = byName.get("doi");
  const doi = (serial && doiField(serial)) || (legacyDoi ? scalarField(legacyDoi) : undefined);
  const type = typeBlock ? scalarField(typeBlock) : undefined;
  const title = field(titleBlock, titleBlock ? scalarField(titleBlock) : undefined);
  const date = field(dateBlock, dateBlock ? scalarField(dateBlock) : undefined);
  const author = field(authorBlock, authors.join(" and "));
  return {
    key: key.key,
    keyFrom: line.from + key.keyFrom,
    keyTo: line.from + key.keyTo,
    from: line.from,
    to,
    isEntry: Boolean(typeBlock || titleBlock),
    ...(type ? { type } : {}),
    ...(title ? { title } : {}),
    ...(author ? { author } : {}),
    authors,
    ...(date ? { date } : {}),
    ...(doi ? { doi } : {}),
  };
}

function flowBlocks(inline: string, line: YamlLine): FieldBlock[] {
  const map = flowMap(inline);
  if (!map) return [];
  return [...map].map(([name, value]) => ({
    name,
    inline: value,
    lines: [],
    from: line.from,
    to: lineEnd(line),
  }));
}

export function hayagrivaEntries(source: string): HayagrivaEntry[] {
  const lines = yamlLines(source);
  const entries: HayagrivaEntry[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.blank || line.indent > 0 || isDocumentMarker(line.text)) continue;
    const key = readMappingKey(line.text, 0);
    if (!key) continue;
    const body: YamlLine[] = [];
    while (index + 1 < lines.length && (lines[index + 1].blank || lines[index + 1].indent > 0)) {
      body.push(lines[index + 1]);
      index += 1;
    }
    const inline = stripComment(line.text.slice(key.valueStart)).trim();
    const lastContent = nestedLines(body).at(-1);
    const to = lastContent ? lineEnd(lastContent) : lineEnd(line);
    const blocks = inline ? flowBlocks(inline, line) : fieldBlocks(body);
    entries.push(entryFromBlocks(key, line, blocks, to));
  }
  return entries;
}

const SNIFF_WINDOW = 8192;

function isDocumentMarker(text: string): boolean {
  return text.startsWith("---") || text.startsWith("...") || text.startsWith("%");
}

export function looksLikeHayagriva(text: string): boolean {
  const lines = yamlLines(text.slice(0, SNIFF_WINDOW));
  let index = 0;
  while (index < lines.length && (lines[index].blank || isDocumentMarker(lines[index].text))) index += 1;
  const first = lines[index];
  if (!first || first.indent > 0) return false;
  const key = readMappingKey(first.text, 0);
  if (!key) return false;
  const inline = stripComment(first.text.slice(key.valueStart)).trim();
  if (inline) {
    const map = flowMap(inline);
    return map !== null && (map.has("type") || map.has("title"));
  }
  const body: YamlLine[] = [];
  for (index += 1; index < lines.length && (lines[index].blank || lines[index].indent > 0); index++) {
    body.push(lines[index]);
  }
  return fieldBlocks(body).some((block) => block.name === "type" || block.name === "title");
}

function normalizedDoi(doi: string): string {
  return doi.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "");
}

export function findHayagrivaKeyByDoi(source: string, doi: string): string | null {
  const wanted = normalizedDoi(doi);
  if (!wanted) return null;
  return hayagrivaEntries(source).find((entry) => entry.doi && normalizedDoi(entry.doi) === wanted)?.key ?? null;
}

export function hayagrivaKeys(source: string): Set<string> {
  return new Set(hayagrivaEntries(source).map((entry) => entry.key));
}

interface PlainYaml {
  readonly plain: string;
}

type YamlNode = string | PlainYaml | readonly YamlNode[] | YamlMap;
type YamlMap = Map<string, YamlNode>;

function isUnsafeCodePoint(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 || code === 0xfeff;
}

export function yamlQuote(value: string): string {
  let out = '"';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (character === "\\") out += String.raw`\\`;
    else if (character === '"') out += String.raw`\"`;
    else if (character === "\n") out += String.raw`\n`;
    else if (character === "\t") out += String.raw`\t`;
    else if (code >= 0xd800 && code <= 0xdfff) out += "\ufffd";
    else if (isUnsafeCodePoint(code)) out += String.raw`\u${code.toString(16).padStart(4, "0")}`;
    else out += character;
  }
  return `${out}"`;
}

const YAML_RESERVED_KEYS = new Set(["true", "false", "yes", "no", "on", "off", "y", "n", "null"]);

function isPlainKeyCharacter(character: string): boolean {
  return /[A-Za-z0-9_-]/.test(character);
}

function yamlKey(key: string): string {
  const plain = /[A-Za-z_]/.test(key[0] ?? "")
    && [...key].every(isPlainKeyCharacter)
    && !YAML_RESERVED_KEYS.has(key.toLowerCase());
  return plain ? key : yamlQuote(key);
}

function serializeMap(map: YamlMap, indent: number, lines: string[]): void {
  const pad = " ".repeat(indent);
  for (const [name, value] of map) {
    if (typeof value === "string") {
      lines.push(`${pad}${name}: ${yamlQuote(value)}`);
    } else if (value instanceof Map) {
      lines.push(`${pad}${name}:`);
      serializeMap(value, indent + 2, lines);
    } else if (Array.isArray(value)) {
      lines.push(`${pad}${name}:`);
      for (const item of value) serializeListItem(item, indent + 2, lines);
    } else {
      lines.push(`${pad}${name}: ${(value as PlainYaml).plain}`);
    }
  }
}

function serializeListItem(item: YamlNode, indent: number, lines: string[]): void {
  const pad = " ".repeat(indent);
  if (typeof item === "string") {
    lines.push(`${pad}- ${yamlQuote(item)}`);
    return;
  }
  if (item instanceof Map) {
    const nested: string[] = [];
    serializeMap(item, indent + 2, nested);
    lines.push(...nested.map((line, index) => (index === 0 ? `${pad}- ${line.trimStart()}` : line)));
  }
}

function plainText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return bibtexTextToUnicode(value) || undefined;
}

function cleanText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const text = bibtexTextToUnicode(value.replaceAll("---", "\u2014").replaceAll("--", "\u2013"))
    .replaceAll("~", " ")
    .trim();
  return text || undefined;
}

function formattable(value: string | undefined): string | undefined {
  const text = cleanText(value);
  return text?.replace(/[\\${}]/g, (character) => `\\${character}`);
}

function splitTopLevel(value: string, separator: (text: string, index: number) => number): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let index = 0;
  while (index < value.length) {
    const character = value[index];
    let step = 1;
    if (character === "{") depth += 1;
    else if (character === "}") depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      const length = separator(value, index);
      if (length > 0) {
        parts.push(value.slice(start, index));
        start = index + length;
        step = length;
      }
    }
    index += step;
  }
  parts.push(value.slice(start));
  return parts.map((part) => part.trim());
}

function andSeparator(text: string, index: number): number {
  if (text[index].trim() !== "") return 0;
  let cursor = index;
  while (text[cursor]?.trim() === "") cursor += 1;
  if (text.slice(cursor, cursor + 3).toLowerCase() !== "and") return 0;
  const after = text[cursor + 3];
  if (after?.trim() !== "") return 0;
  let end = cursor + 3;
  while (text[end]?.trim() === "") end += 1;
  return end - index;
}

function commaSeparator(text: string, index: number): number {
  return text[index] === "," ? 1 : 0;
}

function spaceSeparator(text: string, index: number): number {
  if (text[index].trim() !== "") return 0;
  let end = index;
  while (text[end]?.trim() === "") end += 1;
  return end - index;
}

function startsLowercase(word: string): boolean {
  const letter = word.replace(/^[{\\]+/, "")[0] ?? "";
  return letter !== letter.toUpperCase() && letter === letter.toLowerCase();
}

function splitFirstVonLast(name: string): { given: string; family: string } {
  const words = splitTopLevel(name, spaceSeparator).filter(Boolean);
  if (words.length <= 1) return { given: "", family: words[0] ?? "" };
  const lastIndex = words.length - 1;
  const von = words.slice(0, lastIndex).findIndex(startsLowercase);
  if (von < 0) return { given: words.slice(0, lastIndex).join(" "), family: words[lastIndex] };
  return { given: words.slice(0, von).join(" "), family: words.slice(von).join(" ") };
}

function hayagrivaPerson(name: string): YamlNode | null {
  const parts = splitTopLevel(name, commaSeparator).filter(Boolean);
  if (parts.length === 0 || (parts.length === 1 && parts[0].toLowerCase() === "others")) return null;
  const decoded = parts.map((part) => cleanText(part) ?? "");
  if (parts.length === 1) {
    const split = splitFirstVonLast(parts[0]);
    const family = cleanText(split.family) ?? "";
    const given = cleanText(split.given) ?? "";
    if (family.includes(",") || given.includes(",")) {
      const map: YamlMap = new Map([["name", family]]);
      if (given) map.set("given-name", given);
      return map;
    }
    return given ? `${family}, ${given}` : family || null;
  }
  if (parts.length > 3 || decoded.some((part) => part.includes(","))) {
    return new Map([["name", decoded.join(" ")]]);
  }
  return decoded.join(", ");
}

function hayagrivaPeople(value: string | undefined): YamlNode[] {
  if (!value?.trim()) return [];
  return splitTopLevel(value, andSeparator)
    .map(hayagrivaPerson)
    .filter((person): person is YamlNode => person !== null);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function monthNumber(value: string | undefined): string | undefined {
  const text = (cleanText(value) ?? "").toLowerCase().replace(/\.$/, "");
  if (/^\d{1,2}$/.test(text)) {
    const month = Number(text);
    return month >= 1 && month <= 12 ? twoDigits(month) : undefined;
  }
  const index = MONTHS.indexOf(text.slice(0, 3));
  return index >= 0 ? twoDigits(index + 1) : undefined;
}

function dayNumber(value: string | undefined): string | undefined {
  const text = cleanText(value) ?? "";
  if (!/^\d{1,2}$/.test(text)) return undefined;
  const day = Number(text);
  return day >= 1 && day <= 31 ? twoDigits(day) : undefined;
}

function validIsoDate(value: string | undefined): string | undefined {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(cleanText(value) ?? "");
  if (!match) return undefined;
  if (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 12)) return undefined;
  if (match[3] && (Number(match[3]) < 1 || Number(match[3]) > 31)) return undefined;
  return match[0];
}

function hayagrivaDate(fields: Readonly<Record<string, string>>): string | undefined {
  const explicit = validIsoDate(fields.date);
  if (explicit) return explicit;
  const year = /^(\d{4})[a-z]?$/.exec(cleanText(fields.year) ?? "")?.[1];
  if (!year) return undefined;
  const month = monthNumber(fields.month);
  if (!month) return year;
  const day = dayNumber(fields.day);
  return day ? `${year}-${month}-${day}` : `${year}-${month}`;
}

function absoluteUrl(value: string | undefined): string | undefined {
  const text = value?.trim().replaceAll(/^\{|\}$/g, "").replaceAll(String.raw`\_`, "_").replaceAll(String.raw`\%`, "%").replaceAll(String.raw`\&`, "&");
  if (!text || !/^[a-z][a-z0-9+.-]*:/i.test(text)) return undefined;
  try {
    return new URL(text).protocol ? text : undefined;
  } catch {
    return undefined;
  }
}

function dropSpacesAroundHyphens(text: string): string {
  let out = "";
  let index = 0;
  while (index < text.length) {
    let end = index;
    while (end < text.length && /\s/.test(text[end])) end += 1;
    if (end === index) {
      out += text[index];
      index += 1;
    } else {
      if (text[index - 1] !== "-" && text[end] !== "-") out += text.slice(index, end);
      index = end;
    }
  }
  return out;
}

function pageRange(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return plainText(dropSpacesAroundHyphens(value.replaceAll(/-+|[\u2013\u2014]/g, "-")));
}

interface EntryShape {
  readonly type: string;
  readonly parentType?: string;
  readonly parentTitle?: string;
  readonly genre?: string;
}

function entryShape(type: string, fields: Readonly<Record<string, string>>): EntryShape {
  switch (type) {
    case "article":
      return { type: "article", parentType: "periodical", parentTitle: fields.journal ?? fields.journaltitle };
    case "inproceedings":
    case "conference":
      return { type: "article", parentType: "proceedings", parentTitle: fields.booktitle };
    case "proceedings":
      return { type: "proceedings" };
    case "book":
    case "booklet":
      return { type: "book" };
    case "incollection":
      return { type: "anthos", parentType: "anthology", parentTitle: fields.booktitle };
    case "inbook":
      return fields.booktitle
        ? { type: "chapter", parentType: "book", parentTitle: fields.booktitle }
        : { type: "chapter" };
    case "phdthesis":
      return { type: "thesis", genre: fields.type ?? "Doctoral dissertation" };
    case "mastersthesis":
      return { type: "thesis", genre: fields.type ?? "Master's thesis" };
    case "thesis":
      return { type: "thesis", genre: fields.type };
    case "techreport":
    case "report":
      return { type: "report", genre: fields.type };
    case "online":
    case "electronic":
    case "www":
      return { type: "web" };
    case "unpublished":
      return { type: "manuscript" };
    case "patent":
      return { type: "patent" };
    default:
      return { type: absoluteUrl(fields.url) ? "web" : "misc" };
  }
}

function setValue(map: YamlMap, name: string, value: YamlNode | undefined): void {
  if (value === undefined) return;
  if (Array.isArray(value) && value.length === 0) return;
  if (value instanceof Map && value.size === 0) return;
  map.set(name, value);
}

function serialNumbers(entries: readonly (readonly [string, string | undefined])[]): YamlMap {
  const map: YamlMap = new Map();
  for (const [name, value] of entries) setValue(map, name, plainText(value));
  return map;
}

function publisherNode(name: string | undefined, location: string | undefined): YamlNode | undefined {
  if (!name) return undefined;
  if (!location) return name;
  return new Map([["name", name], ["location", location]]);
}

function arxivId(fields: Readonly<Record<string, string>>): string | undefined {
  const prefix = `${fields.archiveprefix ?? ""} ${fields.eprinttype ?? ""}`;
  return /arxiv/i.test(prefix) ? fields.eprint : undefined;
}

function institutionFor(shape: EntryShape, fields: Readonly<Record<string, string>>): string | undefined {
  if (shape.type === "thesis") return fields.school ?? fields.institution;
  return shape.type === "report" ? fields.institution : undefined;
}

function setPublication(
  map: YamlMap,
  container: YamlMap,
  shape: EntryShape,
  fields: Readonly<Record<string, string>>,
): void {
  const publisherName = formattable(fields.publisher ?? institutionFor(shape, fields));
  const location = formattable(fields.address ?? fields.location);
  setValue(container, "publisher", publisherNode(publisherName, location));
  if (!publisherName) setValue(map, "location", location);
  setValue(container, "organization", formattable(fields.organization));
}

function entrySerialNumbers(
  fields: Readonly<Record<string, string>>,
  hasParent: boolean,
  collection: boolean,
  report: boolean,
): YamlMap {
  return serialNumbers([
    ["doi", fields.doi],
    ["arxiv", arxivId(fields)],
    ["isbn", collection ? undefined : fields.isbn],
    ["issn", hasParent ? undefined : fields.issn],
    ["serial", report ? fields.number : undefined],
  ]);
}

function attachParent(
  map: YamlMap,
  parent: YamlMap,
  fields: Readonly<Record<string, string>>,
  collection: boolean,
): void {
  setValue(parent, "serial-number", serialNumbers([
    ["isbn", collection ? fields.isbn : undefined],
    ["issn", fields.issn],
  ]));
  if (parent.size > 1) map.set("parent", parent);
}

export function bibtexToHayagriva(entry: ParsedBib): string {
  const fields = entry.fields;
  const shape = entryShape(entry.type, fields);
  const report = shape.type === "report";
  const parent: YamlMap | null = shape.parentType ? new Map([["type", { plain: shape.parentType }]]) : null;
  const collection = parent !== null && shape.parentType !== "periodical";
  if (parent) setValue(parent, "title", formattable(shape.parentTitle));

  const map: YamlMap = new Map([["type", { plain: shape.type }]]);
  const container = parent ?? map;
  setValue(map, "title", formattable(fields.title));
  setValue(map, "author", hayagrivaPeople(fields.author));
  setValue(collection && parent ? parent : map, "editor", hayagrivaPeople(fields.editor));
  setValue(map, "date", hayagrivaDate(fields));
  setValue(map, "edition", plainText(fields.edition));
  setValue(container, "volume", plainText(fields.volume));
  if (!report) setValue(container, "issue", plainText(fields.number ?? fields.issue));
  setValue(map, "page-range", pageRange(fields.pages));
  setPublication(map, container, shape, fields);
  setValue(map, "genre", formattable(shape.genre));
  setValue(map, "url", absoluteUrl(fields.url));
  setValue(map, "serial-number", entrySerialNumbers(fields, parent !== null, collection, report));
  setValue(map, "note", formattable(fields.note));
  if (parent) attachParent(map, parent, fields, collection);

  const lines: string[] = [`${yamlKey(entry.key)}:`];
  serializeMap(map, 2, lines);
  return lines.join("\n");
}

export function appendHayagrivaEntries(content: string, blocks: readonly string[]): string {
  const body = blocks.join("\n\n");
  const trimmed = content.trimEnd();
  if (!trimmed || trimmed === "{}") return `${body}\n`;
  const lastLineStart = trimmed.lastIndexOf("\n") + 1;
  if (trimmed.slice(lastLineStart).trim() === "...") {
    const before = trimmed.slice(0, lastLineStart).trimEnd();
    return before ? `${before}\n\n${body}\n...\n` : `${body}\n...\n`;
  }
  return `${trimmed}\n\n${body}\n`;
}
