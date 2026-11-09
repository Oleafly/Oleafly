import { Document, isMap, isScalar, isSeq, parseDocument, type Node as YamlNode, type Pair } from "yaml";
import { readJson, writeJson } from "@/lib/local-storage";

export type PropertyType = "text" | "list" | "number" | "checkbox" | "date" | "link";
export type PropertyValue = string | number | boolean | string[] | null;

export interface NoteProperty {
  key: string;
  type: PropertyType;
  value: PropertyValue;
  readOnly: boolean;
}

export const PROPERTY_TYPES: readonly PropertyType[] = ["text", "list", "number", "checkbox", "date", "link"];
export const MANAGED_KEYS: ReadonlySet<string> = new Set(["title", "kind", "id", "icon", "color", "agent"]);
export const LIST_KEYS: ReadonlySet<string> = new Set(["tags", "aliases"]);

const OPEN = /^﻿?---[ \t]*\r?\n/u;
const CLOSE = /\r?\n(?:---|\.\.\.)[ \t]*$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const NOTE_LINK = /^oleafly:\/\/note\/[\w-]+(?:#\S*)?$/iu;
const TYPES_KEY = "oleafly.notes.propertyTypes";
const STRINGIFY = { lineWidth: 0, minContentWidth: 0, flowCollectionPadding: false } as const;

interface Split {
  open: string;
  inner: string;
  close: string;
  eol: string;
}

function split(frontMatter: string): Split {
  const eol = frontMatter.includes("\r\n") ? "\r\n" : "\n";
  const open = OPEN.exec(frontMatter);
  const close = CLOSE.exec(frontMatter);
  if (!open || !close || close.index < open[0].length - 1) return { open: `---${eol}`, inner: "", close: `${eol}---`, eol };
  return {
    open: open[0],
    inner: frontMatter.slice(open[0].length, close.index),
    close: frontMatter.slice(close.index),
    eol,
  };
}

function join(parts: Split, inner: string): string {
  return inner === "" ? `${parts.open}${parts.close.replace(/^\r?\n/u, "")}` : `${parts.open}${inner}${parts.close}`;
}

function documentOf(inner: string): Document | null {
  const doc = parseDocument(inner, { keepSourceTokens: false });
  if (doc.errors.length > 0) return null;
  if (doc.contents !== null && !isMap(doc.contents)) return null;
  return doc;
}

function pairsOf(doc: Document): Pair<YamlNode, YamlNode | null>[] {
  return isMap(doc.contents) ? (doc.contents.items as Pair<YamlNode, YamlNode | null>[]) : [];
}

function keyName(pair: Pair<YamlNode, YamlNode | null>): string {
  return isScalar(pair.key) ? String(pair.key.value) : "";
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined).map((item) => String(item));
  if (value === null || value === undefined || value === "") return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function inferType(key: string, value: unknown, known?: PropertyType): PropertyType {
  if (LIST_KEYS.has(key)) return "list";
  if (known && compatible(value, known)) return known;
  if (Array.isArray(value)) return "list";
  if (typeof value === "boolean") return "checkbox";
  if (typeof value === "number") return "number";
  if (typeof value === "string" && DATE.test(value)) return "date";
  if (typeof value === "string" && NOTE_LINK.test(value)) return "link";
  return "text";
}

function compatible(value: unknown, type: PropertyType): boolean {
  if (value === null || value === undefined || value === "") return true;
  switch (type) {
    case "list":
      return Array.isArray(value);
    case "checkbox":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number";
    case "date":
      return typeof value === "string" && DATE.test(value);
    case "link":
      return typeof value === "string" && NOTE_LINK.test(value);
    default:
      return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
  }
}

export function convertValue(value: PropertyValue, type: PropertyType): PropertyValue {
  if (type === "list") return asList(value);
  const scalar = Array.isArray(value) ? (value[0] ?? null) : value;
  switch (type) {
    case "checkbox":
      return scalar === true || (typeof scalar === "string" && /^(?:true|yes|1)$/iu.test(scalar.trim()));
    case "number": {
      const number = typeof scalar === "number" ? scalar : Number.parseFloat(String(scalar ?? ""));
      return Number.isFinite(number) ? number : null;
    }
    case "date":
      return typeof scalar === "string" && DATE.test(scalar.trim()) ? scalar.trim() : null;
    case "link":
      return typeof scalar === "string" && NOTE_LINK.test(scalar.trim()) ? scalar.trim() : null;
    default:
      return scalar === null || scalar === undefined ? null : String(scalar);
  }
}

function plainValue(node: YamlNode | null, type: PropertyType): PropertyValue {
  const value: unknown = node === null ? null : node.toJSON();
  if (type === "list") return asList(value);
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

export function readProperties(frontMatter: string, known: Readonly<Record<string, PropertyType>> = {}): NoteProperty[] | null {
  const doc = documentOf(split(frontMatter).inner);
  if (!doc) return null;
  return pairsOf(doc).flatMap((pair) => {
    const key = keyName(pair);
    if (!key || MANAGED_KEYS.has(key)) return [];
    const node = pair.value;
    const raw: unknown = node === null ? null : node.toJSON();
    const nested = isMap(node) || (isSeq(node) && node.items.some((item) => isMap(item) || isSeq(item)));
    const type = nested ? "text" : inferType(key, raw, known[key]);
    return [{ key, type, value: nested ? JSON.stringify(raw) : plainValue(node, type), readOnly: nested }];
  });
}

export function hasProperties(frontMatter: string): boolean {
  return (readProperties(frontMatter) ?? []).length > 0;
}

function valueText(key: string, value: PropertyValue, flow: boolean): string {
  const doc = new Document({ [key]: value });
  if (Array.isArray(value) && isMap(doc.contents)) {
    const node = doc.contents.items[0]?.value;
    if (isSeq(node)) node.flow = flow || value.length === 0;
  }
  return doc.toString(STRINGIFY).replace(/\r?\n$/u, "");
}

function lineStart(text: string, index: number): number {
  return text.lastIndexOf("\n", index - 1) + 1;
}

function lineEnd(text: string, index: number): number {
  const end = text.indexOf("\n", index);
  return end < 0 ? text.length : end;
}

function pairSpan(inner: string, pair: Pair<YamlNode, YamlNode | null>): { from: number; to: number } {
  const keyRange = (pair.key as YamlNode).range ?? [0, 0, 0];
  const valueRange = pair.value?.range;
  const valueEnd = valueRange ? valueRange[1] : keyRange[1];
  const end = lineEnd(inner, Math.max(valueEnd - 1, keyRange[1]));
  return { from: lineStart(inner, keyRange[0]), to: end };
}

function withEol(text: string, eol: string): string {
  return eol === "\n" ? text : text.replace(/\r?\n/gu, eol);
}

function trailingComment(inner: string, pair: Pair<YamlNode, YamlNode | null>, span: { from: number; to: number }): string {
  const value = pair.value;
  if (!value?.range || ((isSeq(value) || isMap(value)) && !value.flow)) return "";
  const comment = /^[ \t]*(#.*?)\r?$/u.exec(inner.slice(value.range[1], span.to));
  return comment ? ` ${comment[1]}` : "";
}

export function setProperty(frontMatter: string, key: string, value: PropertyValue): string {
  const parts = split(frontMatter);
  const doc = documentOf(parts.inner);
  if (!doc || MANAGED_KEYS.has(key)) return frontMatter;
  const pair = pairsOf(doc).find((candidate) => keyName(candidate) === key);
  if (!pair) {
    const text = withEol(valueText(key, value, false), parts.eol);
    const base = parts.inner.replace(/[ \t\r\n]*$/u, "");
    return join(parts, base ? `${base}${parts.eol}${text}` : text);
  }
  const span = pairSpan(parts.inner, pair);
  const flow = isSeq(pair.value) && Boolean(pair.value.flow);
  const comment = trailingComment(parts.inner, pair, span);
  const text = withEol(valueText(key, value, flow), parts.eol) + comment;
  const carriage = parts.inner.slice(span.from, span.to).endsWith("\r") ? "\r" : "";
  return join(parts, `${parts.inner.slice(0, span.from)}${text}${carriage}${parts.inner.slice(span.to)}`);
}

function withoutPair(parts: Split, pair: Pair<YamlNode, YamlNode | null>): string {
  const { inner } = parts;
  const span = pairSpan(inner, pair);
  if (span.to < inner.length) return join(parts, `${inner.slice(0, span.from)}${inner.slice(span.to + 1)}`);
  const start = span.from > 0 ? span.from - (inner[span.from - 2] === "\r" ? 2 : 1) : 0;
  return join(parts, inner.slice(0, start));
}

export function removeProperty(frontMatter: string, key: string): string {
  const parts = split(frontMatter);
  const doc = documentOf(parts.inner);
  const pair = doc && !MANAGED_KEYS.has(key) ? pairsOf(doc).find((candidate) => keyName(candidate) === key) : undefined;
  return pair ? withoutPair(parts, pair) : frontMatter;
}

const IDENTITY_KEYS: ReadonlySet<string> = new Set(["kind", "id"]);

function entryTexts(frontMatter: string): Map<string, string> | null {
  const parts = split(frontMatter);
  const doc = documentOf(parts.inner);
  if (!doc) return null;
  const entries = new Map<string, string>();
  for (const pair of pairsOf(doc)) {
    const key = keyName(pair);
    if (!key) continue;
    const span = pairSpan(parts.inner, pair);
    entries.set(key, parts.inner.slice(span.from, span.to).replace(/\r/gu, ""));
  }
  return entries;
}

function insertEntry(parts: Split, pairs: Pair<YamlNode, YamlNode | null>[], lines: string, after: string | null): string {
  const { inner, eol } = parts;
  const anchor = after === null ? undefined : pairs.find((candidate) => keyName(candidate) === after);
  if (anchor) {
    const at = pairSpan(inner, anchor).to;
    if (at < inner.length) return join(parts, `${inner.slice(0, at + 1)}${lines}${eol}${inner.slice(at + 1)}`);
    return join(parts, `${inner}${eol}${lines}`);
  }
  if (after === null && pairs.length > 0) return join(parts, `${lines}${eol}${inner}`);
  const base = inner.replace(/[ \t\r\n]*$/u, "");
  return join(parts, base ? `${base}${eol}${lines}` : lines);
}

function withEntryText(frontMatter: string, key: string, text: string | null, after: string | null): string {
  const parts = split(frontMatter);
  const doc = documentOf(parts.inner);
  if (!doc) return frontMatter;
  const pairs = pairsOf(doc);
  const pair = pairs.find((candidate) => keyName(candidate) === key);
  if (text === null) return pair ? withoutPair(parts, pair) : frontMatter;
  const lines = withEol(text, parts.eol);
  if (!pair) return insertEntry(parts, pairs, lines, after);
  const span = pairSpan(parts.inner, pair);
  const carriage = parts.inner.slice(span.from, span.to).endsWith("\r") ? "\r" : "";
  return join(parts, `${parts.inner.slice(0, span.from)}${lines}${carriage}${parts.inner.slice(span.to)}`);
}

export function mergeFrontMatter(base: string, mine: string, theirs: string): string {
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
    if (IDENTITY_KEYS.has(key) && theirEntries.has(key)) continue;
    const index = order.indexOf(key);
    merged = withEntryText(merged, key, local, index > 0 ? order[index - 1] : null);
  }
  return merged;
}

export function renameProperty(frontMatter: string, from: string, to: string): string {
  const name = to.trim();
  if (!name || name === from || MANAGED_KEYS.has(name) || MANAGED_KEYS.has(from)) return frontMatter;
  const parts = split(frontMatter);
  const doc = documentOf(parts.inner);
  if (!doc) return frontMatter;
  const pairs = pairsOf(doc);
  if (pairs.some((candidate) => keyName(candidate) === name)) return frontMatter;
  const pair = pairs.find((candidate) => keyName(candidate) === from);
  const range = pair?.key ? (pair.key as YamlNode).range : undefined;
  if (!range) return frontMatter;
  const key = new Document(name).toString(STRINGIFY).replace(/\r?\n$/u, "");
  return join(parts, `${parts.inner.slice(0, range[0])}${key}${parts.inner.slice(range[1])}`);
}

export function canAddProperty(frontMatter: string, key: string): boolean {
  const name = key.trim();
  if (!name || MANAGED_KEYS.has(name)) return false;
  const props = readProperties(frontMatter);
  return props !== null && !props.some((property) => property.key === name);
}

export function emptyValue(type: PropertyType): PropertyValue {
  if (type === "list") return [];
  if (type === "checkbox") return false;
  return null;
}

function propertyTypesOf(parsed: unknown): Record<string, PropertyType> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter((entry): entry is [string, PropertyType] => PROPERTY_TYPES.includes(entry[1] as PropertyType)),
  );
}

export function readPropertyTypes(): Record<string, PropertyType> {
  return readJson(TYPES_KEY, {}, propertyTypesOf);
}

export function savePropertyType(key: string, type: PropertyType): void {
  writeJson(TYPES_KEY, { ...readPropertyTypes(), [key]: type });
}
