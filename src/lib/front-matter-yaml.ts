import { splitMarkdownFrontMatter } from "@oleafly/wysiwyg/front-matter";
import { Document, isAlias, isMap, isPair, isScalar, isSeq, parseDocument, Scalar, type Node as YamlNode, type Pair } from "yaml";

export type FrontMatterValue = string | number | boolean | readonly string[] | null;

export interface FrontMatterEntry {
  key: string;
  value: unknown;
  nested: boolean;
}

type YamlPair = Pair<YamlNode, YamlNode | null>;

interface Parts {
  open: string;
  inner: string;
  close: string;
  eol: string;
}

const STRINGIFY = { lineWidth: 0, minContentWidth: 0, flowCollectionPadding: false } as const;
const OLD_BOOLEAN = /^(?:yes|no|on|off)$/iu;
const QUOTED = new Set<string>([Scalar.QUOTE_SINGLE, Scalar.QUOTE_DOUBLE]);

function partsOf(block: string): Parts {
  const eol = block.includes("\r\n") ? "\r\n" : "\n";
  if (!block || splitMarkdownFrontMatter(block).frontmatter !== block) return { open: `---${eol}`, inner: "", close: `${eol}---`, eol };
  const innerFrom = block.indexOf("\n") + 1;
  const lastBreak = block.lastIndexOf("\n");
  const closeFrom = block[lastBreak - 1] === "\r" ? lastBreak - 1 : lastBreak;
  return { open: block.slice(0, innerFrom), inner: block.slice(innerFrom, Math.max(innerFrom, closeFrom)), close: block.slice(closeFrom), eol };
}

function join(parts: Parts, inner: string): string {
  return inner === "" ? `${parts.open}${parts.close.replace(/^\r?\n/u, "")}` : `${parts.open}${inner}${parts.close}`;
}

function documentOf(inner: string, strict = true): Document | null {
  const doc = parseDocument(inner, { keepSourceTokens: false, uniqueKeys: strict });
  if (doc.contents !== null && !isMap(doc.contents)) return null;
  return strict && doc.errors.length > 0 ? null : doc;
}

function pairsOf(doc: Document): YamlPair[] {
  return isMap(doc.contents) ? (doc.contents.items as YamlPair[]) : [];
}

function keyName(pair: YamlPair): string {
  return isScalar(pair.key) ? String(pair.key.value) : "";
}

function lastPair(pairs: readonly YamlPair[], key: string): YamlPair | undefined {
  for (let index = pairs.length - 1; index >= 0; index -= 1) {
    if (keyName(pairs[index]) === key) return pairs[index];
  }
  return undefined;
}

function lineStart(text: string, index: number): number {
  return text.lastIndexOf("\n", index - 1) + 1;
}

function lineEnd(text: string, index: number): number {
  const end = text.indexOf("\n", index);
  return end < 0 ? text.length : end;
}

function pairSpan(inner: string, pair: YamlPair): { from: number; to: number } {
  const keyRange = pair.key.range ?? [0, 0, 0];
  const valueEnd = pair.value?.range ? pair.value.range[1] : keyRange[1];
  return { from: lineStart(inner, keyRange[0]), to: lineEnd(inner, Math.max(valueEnd - 1, keyRange[1])) };
}

function keyLine(inner: string, pair: YamlPair): { from: number; to: number } {
  const at = pair.key.range?.[0] ?? 0;
  return { from: lineStart(inner, at), to: lineEnd(inner, at) };
}

function withEol(text: string, eol: string): string {
  return eol === "\n" ? text : text.replaceAll(/\r?\n/gu, eol);
}

function quoteStyle(value: FrontMatterValue, like: YamlNode | null | undefined): Scalar.Type | null {
  if (isScalar(like) && like.type && QUOTED.has(like.type)) return like.type;
  return OLD_BOOLEAN.test(String(value)) ? Scalar.QUOTE_DOUBLE : null;
}

function valueText(key: string, value: FrontMatterValue, like: YamlNode | null | undefined): string {
  const doc = new Document({});
  let node: unknown = value;
  const quote = quoteStyle(value, like);
  if (typeof value === "string" && quote) {
    const scalar = new Scalar(value);
    scalar.type = quote;
    node = scalar;
  }
  const pair = doc.createPair(key, node);
  if (isSeq(pair.value)) pair.value.flow = (isSeq(like) && Boolean(like.flow)) || (Array.isArray(value) && value.length === 0);
  if (isMap(doc.contents)) doc.contents.items.push(pair);
  return doc.toString(STRINGIFY).replace(/\r?\n$/u, "");
}

function trailingComment(inner: string, pair: YamlPair, span: { from: number; to: number }): string {
  const value = pair.value;
  if (!value?.range || ((isSeq(value) || isMap(value)) && !value.flow)) return "";
  const comment = /^[ \t]*(#.*?)\r?$/u.exec(inner.slice(value.range[1], span.to));
  return comment ? ` ${comment[1]}` : "";
}

function replaceSpan(parts: Parts, span: { from: number; to: number }, text: string): string {
  const { inner } = parts;
  const carriage = inner.slice(span.from, span.to).endsWith("\r") ? "\r" : "";
  return join(parts, `${inner.slice(0, span.from)}${text}${carriage}${inner.slice(span.to)}`);
}

function withoutTrailingWhitespace(text: string): string {
  let end = text.length;
  while (end > 0 && " \t\r\n".includes(text.charAt(end - 1))) end -= 1;
  return text.slice(0, end);
}

function appendEntry(parts: Parts, text: string): string {
  const base = withoutTrailingWhitespace(parts.inner);
  return join(parts, base ? `${base}${parts.eol}${text}` : text);
}

function withoutPair(parts: Parts, pair: YamlPair): string {
  const { inner } = parts;
  const span = pairSpan(inner, pair);
  if (span.to < inner.length) return join(parts, `${inner.slice(0, span.from)}${inner.slice(span.to + 1)}`);
  if (span.from === 0) return join(parts, "");
  const breakWidth = inner[span.from - 2] === "\r" ? 2 : 1;
  return join(parts, inner.slice(0, span.from - breakWidth));
}

function edited(block: string, strict: boolean, edit: (parts: Parts, pairs: YamlPair[], broken: boolean) => string): string {
  const parts = partsOf(block);
  const doc = documentOf(parts.inner, strict);
  return doc ? edit(parts, pairsOf(doc), doc.errors.length > 0) : block;
}

function writeValue(block: string, key: string, value: FrontMatterValue, strict: boolean): string {
  return edited(block, strict, (parts, pairs, broken) => {
    const pair = lastPair(pairs, key);
    if (!pair) return appendEntry(parts, withEol(valueText(key, value, null), parts.eol));
    const runOn = broken && isMap(pair.value) && !pair.value.flow;
    if (!strict && !runOn && pair.value !== null && !isScalar(pair.value)) return block;
    const span = runOn ? keyLine(parts.inner, pair) : pairSpan(parts.inner, pair);
    return replaceSpan(parts, span, withEol(valueText(key, value, pair.value), parts.eol) + trailingComment(parts.inner, pair, span));
  });
}

function removeValue(block: string, key: string, strict: boolean): string {
  return edited(block, strict, (parts, pairs) => {
    const pair = lastPair(pairs, key);
    return pair ? withoutPair(parts, pair) : block;
  });
}

function resolved(doc: Document, node: unknown): unknown {
  return isAlias(node) ? (node.resolve(doc) ?? node) : node;
}

function isCollection(doc: Document, node: unknown): boolean {
  const target = resolved(doc, node);
  return isMap(target) || isSeq(target);
}

function holdsAlias(node: unknown): boolean {
  if (isAlias(node)) return true;
  if (isPair(node)) return holdsAlias(node.key) || holdsAlias(node.value);
  const items: readonly unknown[] = isMap(node) || isSeq(node) ? node.items : [];
  return items.some(holdsAlias);
}

function printable(value: unknown): boolean {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

function plainValue(doc: Document, node: YamlNode): unknown {
  const plain = node.toJSON() as unknown;
  if (!holdsAlias(node)) return plain;
  try {
    const value = node.toJS(doc) as unknown;
    return printable(value) ? value : plain;
  } catch {
    return plain;
  }
}

export function frontMatterEntries(block: string): FrontMatterEntry[] | null {
  const doc = documentOf(partsOf(block).inner);
  if (!doc) return null;
  return pairsOf(doc).flatMap((pair) => {
    const key = keyName(pair);
    if (!key) return [];
    const node = pair.value;
    const target = resolved(doc, node);
    const nested = isMap(target) || (isSeq(target) && target.items.some((item) => isCollection(doc, item)));
    return [{ key, value: node === null ? null : plainValue(doc, node), nested }];
  });
}

function listItems(value: unknown, split: RegExp): unknown[] {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined);
  return value === null || value === undefined ? [] : String(value).split(split);
}

export function readList(value: unknown, split: RegExp): string[] {
  return listItems(value, split).map((item) => String(item).trim()).filter(Boolean);
}

export function setProperty(block: string, key: string, value: FrontMatterValue): string {
  return writeValue(block, key, value, true);
}

export function removeProperty(block: string, key: string): string {
  return removeValue(block, key, true);
}

export function renameProperty(block: string, from: string, to: string): string {
  return edited(block, true, (parts, pairs) => {
    if (pairs.some((candidate) => keyName(candidate) === to)) return block;
    const range = pairs.find((candidate) => keyName(candidate) === from)?.key.range;
    if (!range) return block;
    const key = new Document(to).toString(STRINGIFY).replace(/\r?\n$/u, "");
    return join(parts, `${parts.inner.slice(0, range[0])}${key}${parts.inner.slice(range[1])}`);
  });
}

function entryTexts(block: string): Map<string, string> | null {
  const parts = partsOf(block);
  const doc = documentOf(parts.inner);
  if (!doc) return null;
  const entries = new Map<string, string>();
  for (const pair of pairsOf(doc)) {
    const key = keyName(pair);
    if (!key) continue;
    const span = pairSpan(parts.inner, pair);
    entries.set(key, parts.inner.slice(span.from, span.to).replaceAll("\r", ""));
  }
  return entries;
}

function insertEntry(parts: Parts, pairs: readonly YamlPair[], lines: string, after: string | null): string {
  const { inner, eol } = parts;
  const anchor = after === null ? undefined : pairs.find((candidate) => keyName(candidate) === after);
  if (anchor) {
    const at = pairSpan(inner, anchor).to;
    if (at < inner.length) return join(parts, `${inner.slice(0, at + 1)}${lines}${eol}${inner.slice(at + 1)}`);
    return join(parts, `${inner}${eol}${lines}`);
  }
  if (after === null && pairs.length > 0) return join(parts, `${lines}${eol}${inner}`);
  return appendEntry(parts, lines);
}

function withEntryText(block: string, key: string, text: string | null, after: string | null): string {
  return edited(block, true, (parts, pairs) => {
    const pair = pairs.find((candidate) => keyName(candidate) === key);
    if (text === null) return pair ? withoutPair(parts, pair) : block;
    const lines = withEol(text, parts.eol);
    return pair ? replaceSpan(parts, pairSpan(parts.inner, pair), lines) : insertEntry(parts, pairs, lines, after);
  });
}

export function mergeFrontMatter(base: string, mine: string, theirs: string, keepTheirs: ReadonlySet<string>): string {
  if (mine === base || mine === theirs) return theirs;
  if (theirs === base) return mine;
  const baseEntries = entryTexts(base);
  const mineEntries = entryTexts(mine);
  const theirEntries = entryTexts(theirs);
  if (!baseEntries || !mineEntries || !theirEntries) return mine;
  const order = [...mineEntries.keys()];
  let merged = theirs;
  for (const key of new Set([...baseEntries.keys(), ...order])) {
    const local = mineEntries.get(key) ?? null;
    if (local === (baseEntries.get(key) ?? null)) continue;
    if (keepTheirs.has(key) && theirEntries.has(key)) continue;
    const index = order.indexOf(key);
    merged = withEntryText(merged, key, local, index > 0 ? order[index - 1] : null);
  }
  return merged;
}

export function appendEntries(block: string, text: string): string {
  const parts = partsOf(block);
  return appendEntry(parts, withEol(text, parts.eol));
}

export function withFrontMatter(text: string, edit: (block: string) => string): string {
  const { frontmatter } = splitMarkdownFrontMatter(text);
  if (frontmatter) {
    const next = edit(frontmatter);
    return next === frontmatter ? text : `${next}${text.slice(frontmatter.length)}`;
  }
  if (/^﻿?---[ \t]*(?:\r?\n|$)/u.test(text)) return text;
  const next = edit("");
  if (next === "") return text;
  const bom = text.startsWith("﻿") ? "﻿" : "";
  const rest = text.slice(bom.length);
  const eol = rest.includes("\r\n") ? "\r\n" : "\n";
  return `${bom}${withEol(next, eol)}${eol}${/^\r?\n/u.test(rest) ? "" : eol}${rest}`;
}

export function setScalar(text: string, key: string, value: string | null): string {
  return withFrontMatter(text, (block) => (value === null ? removeValue(block, key, false) : writeValue(block, key, value, false)));
}
