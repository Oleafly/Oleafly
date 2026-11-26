import { compareCandidates, compareKeys, keysOf, type LanguageIndex } from "./library";
import { EVERY_KEY } from "./trigger";
import type { Expand, ResolvedPlace, SnippetLanguage, SnippetRecord } from "./types";

export interface MatchContext {
  language: SnippetLanguage;
  lineBefore: string;
  typstVersion?: [number, number];
}

export interface Hit {
  record: SnippetRecord;
  from: number;
  captures: string[];
}

interface HintCandidate {
  record: SnippetRecord;
  typed: string;
  rest: string;
  exact: boolean;
}

const REGEX_LOOK_BACK = 100;
const SLOW_REGEX_MS = 2;

const WORD_CHAR = /[\p{L}\p{N}]/u;
const LETTER = /\p{L}/u;
const DIGIT = /\d/;
const ASCII_LETTER = /[A-Za-z]/;
const TOKEN_CHAR = /[\p{L}\p{N}_:.-]/u;
const SPACE = /\s/;

interface KeyEntry {
  key: string;
  record: SnippetRecord;
}

interface KeyTable {
  keys: KeyEntry[];
  exact: Map<string, SnippetRecord[]>;
  longest: number;
}

const tables = new WeakMap<LanguageIndex, KeyTable>();
const slowRecords = new WeakSet<SnippetRecord>();

function keyTable(index: LanguageIndex): KeyTable {
  const cached = tables.get(index);
  if (cached) return cached;
  const keys: KeyEntry[] = [];
  const exact = new Map<string, SnippetRecord[]>();
  let longest = 0;
  for (const record of index.prefixSorted) {
    for (const key of keysOf(record)) {
      keys.push({ key, record });
      const list = exact.get(key);
      if (list) list.push(record);
      else exact.set(key, [record]);
      longest = Math.max(longest, key.length);
    }
  }
  keys.sort((a, b) => compareKeys(a.key, b.key));
  const table = { keys, exact, longest };
  tables.set(index, table);
  return table;
}

function lowerBound(keys: readonly KeyEntry[], prefix: string): number {
  let low = 0;
  let high = keys.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (keys[middle].key < prefix) low = middle + 1;
    else high = middle;
  }
  return low;
}

function versionAllows(record: SnippetRecord, ctx: MatchContext): boolean {
  const since = record.typstSince;
  const version = ctx.typstVersion;
  if (!since || !version) return true;
  return version[0] > since[0] || (version[0] === since[0] && version[1] >= since[1]);
}

function oddBackslashesBefore(line: string, end: number): boolean {
  let count = 0;
  for (let index = end - 1; index >= 0 && line[index] === "\\"; index -= 1) count += 1;
  return count % 2 === 1;
}

function boundaryAllows(record: SnippetRecord, line: string, from: number): boolean {
  if (record.lineStart) {
    for (let index = from - 1; index >= 0; index -= 1) if (!SPACE.test(line[index])) return false;
  }
  const previous = line[from - 1];
  if (!record.inWord && previous !== undefined && (previous === "\\" || WORD_CHAR.test(previous))) return false;
  const first = line[from];
  let start = from;
  if (ASCII_LETTER.test(first)) while (start > 0 && ASCII_LETTER.test(line[start - 1])) start -= 1;
  if (oddBackslashesBefore(line, start)) return false;
  if (first !== "@" && TOKEN_CHAR.test(first)) {
    let token = from;
    while (token > 0 && TOKEN_CHAR.test(line[token - 1])) token -= 1;
    if (line[token - 1] === "@") return false;
  }
  return true;
}

export function placeAllows(record: SnippetRecord, place: ResolvedPlace): boolean {
  switch (record.place) {
    case "any":
      return true;
    case "math":
      return place === "inline-math" || place === "display-math";
    default:
      return record.place === place;
  }
}

function sortHits(hits: Hit[], end: number): Hit[] {
  return hits.sort((a, b) => compareCandidates(a.record, b.record, end - a.from, end - b.from));
}

function regexBuckets(index: LanguageIndex, lastChar: string): (readonly SnippetRecord[])[] {
  const buckets: (readonly SnippetRecord[] | undefined)[] = [index.regexByEnd.get(lastChar)];
  if (DIGIT.test(lastChar)) buckets.push(index.regexByEnd.get("digit"));
  else if (LETTER.test(lastChar)) buckets.push(index.regexByEnd.get("letter"));
  buckets.push(index.regexByEnd.get(EVERY_KEY));
  return buckets.filter((bucket): bucket is readonly SnippetRecord[] => bucket !== undefined);
}

function timedExec(regex: RegExp, text: string): [RegExpExecArray | null, number] {
  const started = performance.now();
  const match = regex.exec(text);
  return [match, performance.now() - started];
}

function slowExec(regex: RegExp, text: string): [RegExpExecArray | null, boolean] {
  const [match, took] = timedExec(regex, text);
  if (took <= SLOW_REGEX_MS) return [match, false];
  const [again, retook] = timedExec(regex, text);
  return [again, retook > SLOW_REGEX_MS];
}

function regexHits(
  index: LanguageIndex,
  ctx: MatchContext,
  expand: Expand,
  hits: Hit[],
  onSlowRegex?: (record: SnippetRecord) => void,
): void {
  const line = ctx.lineBefore;
  const offset = Math.max(0, line.length - REGEX_LOOK_BACK);
  const tail = line.slice(offset);
  for (const bucket of regexBuckets(index, line.slice(-1))) {
    for (const record of bucket) {
      if (record.expand !== expand || slowRecords.has(record) || !versionAllows(record, ctx)) continue;
      const [match, slow] = slowExec(record.regex as RegExp, tail);
      if (slow) {
        slowRecords.add(record);
        onSlowRegex?.(record);
      }
      if (!match || match[0].length === 0) continue;
      const from = offset + match.index;
      if (boundaryAllows(record, line, from)) {
        hits.push({ record, from, captures: match.slice(1).map((capture) => capture ?? "") });
      }
    }
  }
}

export function autoCandidates(
  index: LanguageIndex,
  ctx: MatchContext,
  lastChar: string,
  onSlowRegex: (record: SnippetRecord) => void,
): Hit[] {
  const line = ctx.lineBefore;
  const hits: Hit[] = [];
  for (const record of index.autoByLastChar.get(lastChar) ?? []) {
    if (!versionAllows(record, ctx)) continue;
    const keys = keysOf(record)
      .filter((key) => key.endsWith(lastChar) && line.endsWith(key))
      .sort((a, b) => b.length - a.length);
    const key = keys.find((candidate) => boundaryAllows(record, line, line.length - candidate.length));
    if (key !== undefined) hits.push({ record, from: line.length - key.length, captures: [] });
  }
  if (line.endsWith(lastChar)) regexHits(index, ctx, "auto", hits, onSlowRegex);
  return sortHits(hits, line.length);
}

function exactHits(index: LanguageIndex, ctx: MatchContext, accept: (record: SnippetRecord) => boolean): Hit[] {
  const line = ctx.lineBefore;
  const table = keyTable(index);
  const hits: Hit[] = [];
  for (let length = Math.min(table.longest, line.length); length >= 1; length -= 1) {
    const from = line.length - length;
    for (const record of table.exact.get(line.slice(from)) ?? []) {
      if (!accept(record) || !versionAllows(record, ctx) || hits.some((hit) => hit.record === record)) continue;
      if (boundaryAllows(record, line, from)) hits.push({ record, from, captures: [] });
    }
  }
  return hits;
}

export function tabCandidates(
  index: LanguageIndex,
  ctx: MatchContext,
  onSlowRegex?: (record: SnippetRecord) => void,
): Hit[] {
  if (!ctx.lineBefore) return [];
  const hits = exactHits(index, ctx, (record) => record.expand === "tab");
  regexHits(index, ctx, "tab", hits, onSlowRegex);
  return sortHits(hits, ctx.lineBefore.length);
}

export function listMatches(index: LanguageIndex, ctx: MatchContext, typed: string): SnippetRecord[] {
  const { keys } = keyTable(index);
  const line = ctx.lineBefore;
  const from = Math.max(0, line.length - typed.length);
  const matches: SnippetRecord[] = [];
  for (let position = lowerBound(keys, typed); position < keys.length && keys[position].key.startsWith(typed); position += 1) {
    const { record } = keys[position];
    if (record.expand === "auto" || matches.includes(record) || !versionAllows(record, ctx)) continue;
    if (boundaryAllows(record, line, from)) matches.push(record);
  }
  return matches;
}

export function hintCandidate(index: LanguageIndex, ctx: MatchContext): HintCandidate | null {
  const line = ctx.lineBefore;
  const [best] = sortHits(
    exactHits(index, ctx, (record) => record.expand !== "auto"),
    line.length,
  );
  if (best) return { record: best.record, typed: line.slice(best.from), rest: "", exact: true };
  let from = line.length;
  while (from > 0 && LETTER.test(line[from - 1])) from -= 1;
  const word = line.slice(from);
  if (word.length < 2) return null;
  const { keys } = keyTable(index);
  let found: KeyEntry | null = null;
  for (let position = lowerBound(keys, word); position < keys.length && keys[position].key.startsWith(word); position += 1) {
    const entry = keys[position];
    const { record } = entry;
    if (entry.key === word || record.expand === "auto" || !versionAllows(record, ctx)) continue;
    if (!boundaryAllows(record, line, from)) continue;
    if (!found) {
      found = entry;
      continue;
    }
    if (entry.record === found.record) continue;
    if (entry.key === found.key || !entry.key.startsWith(found.key)) return null;
  }
  return found ? { record: found.record, typed: word, rest: found.key.slice(word.length), exact: false } : null;
}
