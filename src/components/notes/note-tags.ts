import { backtickRunEnd, codeSpanEnd, fencedLines } from "@/lib/code-fences";
import { frontMatterKey, frontMatterRawValue, quotedScalar, splitFrontMatter } from "@/lib/front-matter";

export interface TagRange {
  from: number;
  to: number;
  tag: string;
}

const TAG_RUN = /[\p{L}\p{N}_\-/]+/uy;
const NOT_DIGIT = /[^\p{N}]/u;
const SPACE = /\s/u;
const SCHEME_URL = /[A-Za-z][A-Za-z0-9+.-]*:\/\/\S*/uy;
const SCHEME_CHAR = /[A-Za-z0-9+.-]/u;
const AUTOLINK = /<[A-Za-z][A-Za-z0-9+.-]*:[^\s<>]*>/uy;
const INLINE_LINK = /\[[^[\]\n]*\]\([^)\n]*\)/uy;
const LIST_ITEM = /^[ \t]*-(?:[ \t]+(.*))?$/u;

function stripSlashes(run: string): { lead: number; tag: string } {
  let start = 0;
  let end = run.length;
  while (start < end && run[start] === "/") start++;
  while (end > start && run[end - 1] === "/") end--;
  return { lead: start, tag: run.slice(start, end) };
}

export function isTagStart(text: string, index: number): boolean {
  if (text[index] !== "#") return false;
  if (index === 0) return true;
  const before = text[index - 1];
  return before === "(" || SPACE.test(before);
}

export function tagAt(text: string, index: number): TagRange | null {
  if (!isTagStart(text, index)) return null;
  TAG_RUN.lastIndex = index + 1;
  const run = TAG_RUN.exec(text)?.[0];
  if (!run) return null;
  const { lead, tag } = stripSlashes(run);
  if (!tag || !NOT_DIGIT.test(tag)) return null;
  return { from: index, to: index + 1 + lead + tag.length, tag };
}

function urlEnd(text: string, index: number): number {
  if (index > 0 && SCHEME_CHAR.test(text[index - 1])) return index;
  SCHEME_URL.lastIndex = index;
  const url = SCHEME_URL.exec(text)?.[0];
  return url ? index + url.length : index;
}

export function plainTextTags(text: string): TagRange[] {
  const found: TagRange[] = [];
  let index = 0;
  while (index < text.length) {
    const end = urlEnd(text, index);
    if (end > index) {
      index = end;
      continue;
    }
    const tag = tagAt(text, index);
    if (tag) {
      found.push(tag);
      index = tag.to;
      continue;
    }
    index++;
  }
  return found;
}

function stickyEnd(pattern: RegExp, line: string, index: number): number {
  pattern.lastIndex = index;
  const match = pattern.exec(line)?.[0];
  return match ? index + match.length : index;
}

function destinationEnd(line: string, index: number): number {
  const close = line.indexOf(")", index + 2);
  return close < 0 ? line.length : close + 1;
}

function skipAt(line: string, index: number): number {
  const char = line[index];
  if (char === "\\") return Math.min(line.length, index + 2);
  if (char === "`") return codeSpanEnd(line, index) ?? backtickRunEnd(line, index);
  if (char === "[") return stickyEnd(INLINE_LINK, line, index);
  if (char === "]" && line[index + 1] === "(") return destinationEnd(line, index);
  if (char === "<") return stickyEnd(AUTOLINK, line, index);
  return urlEnd(line, index);
}

function lineTags(line: string, offset: number, found: TagRange[]): void {
  let index = 0;
  while (index < line.length) {
    const skipped = skipAt(line, index);
    if (skipped > index) {
      index = skipped;
      continue;
    }
    const tag = tagAt(line, index);
    if (tag) {
      found.push({ from: tag.from + offset, to: tag.to + offset, tag: tag.tag });
      index = tag.to;
      continue;
    }
    index++;
  }
}

export function markdownTagRanges(markdown: string): TagRange[] {
  const front = splitFrontMatter(markdown);
  const offset = front?.bodyFrom ?? 0;
  const found: TagRange[] = [];
  for (const line of fencedLines(front ? front.body : markdown)) {
    if (!line.fenced) lineTags(line.text, offset + line.from, found);
  }
  return found;
}

function scalarItem(raw: string): string {
  const trimmed = raw.trim();
  return quotedScalar(trimmed)?.value ?? trimmed;
}

function cleanItem(item: string): string {
  return item.trim().replace(/^#+/u, "").trim();
}

function flowItems(value: string): string[] {
  const items: string[] = [];
  let index = 1;
  while (index < value.length && value[index] !== "]") {
    const rest = value.slice(index).trimStart();
    index = value.length - rest.length;
    const quoted = quotedScalar(rest);
    let end = quoted ? index + quoted.end : index;
    while (end < value.length && value[end] !== "," && value[end] !== "]") end++;
    items.push(quoted ? quoted.value : value.slice(index, end));
    index = value[end] === "," ? end + 1 : end;
  }
  return items;
}

const SCALAR_SPLIT: Readonly<Record<string, RegExp>> = { aliases: /,/u };
const DEFAULT_SPLIT = /[,\s]+/u;

export function frontMatterList(markdown: string, key: string): string[] {
  const yaml = splitFrontMatter(markdown)?.lines ?? [];
  const at = yaml.findIndex((line) => frontMatterKey(line) === key);
  if (at < 0) return [];
  const value = frontMatterRawValue(yaml[at]);
  let items: string[];
  if (value.startsWith("[")) {
    items = flowItems(value);
  } else if (value !== "") {
    items = scalarItem(value).split(SCALAR_SPLIT[key] ?? DEFAULT_SPLIT);
  } else {
    items = [];
    for (const line of yaml.slice(at + 1)) {
      if (line.trim() === "") continue;
      const item = LIST_ITEM.exec(line);
      if (!item) break;
      items.push(scalarItem(item[1] ?? ""));
    }
  }
  return items.map(cleanItem).filter((item) => item !== "");
}

export function tagKey(tag: string): string {
  return tag.toLowerCase();
}

function uniqueTags(markdown: string): string[] {
  const seen = new Map<string, string>();
  const all = [...frontMatterList(markdown, "tags"), ...markdownTagRanges(markdown).map((range) => range.tag)];
  for (const tag of all) {
    const key = tagKey(tag);
    if (!seen.has(key)) seen.set(key, tag);
  }
  return [...seen.values()];
}

export function displayTags(markdown: string): string[] {
  return uniqueTags(markdown);
}

export function noteTags(markdown: string): string[] {
  return uniqueTags(markdown).map(tagKey);
}

export function tagMatches(tag: string, filter: string): boolean {
  const key = tagKey(tag);
  const wanted = tagKey(filter).replace(/^#+/u, "");
  return key === wanted || key.startsWith(`${wanted}/`);
}
