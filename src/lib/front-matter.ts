import { splitMarkdownFrontMatter } from "@oleafly/wysiwyg/front-matter";

export interface FrontMatter {
  readonly lines: readonly string[];
  readonly body: string;
  readonly bodyFrom: number;
}

export interface QuotedScalar {
  readonly value: string;
  readonly end: number;
}

const LINE_BREAK = /\r?\n/u;
const NOT_A_KEY = /^[ \t#-]/u;
const QUOTED_KEY = /^(["'])(.*)\1$/su;
const COMMENT = /\s#/u;

function doubleQuoted(source: string): QuotedScalar | null {
  let index = 1;
  while (index < source.length && source[index] !== '"') index += source[index] === "\\" ? 2 : 1;
  if (index >= source.length) return null;
  try {
    return { value: JSON.parse(source.slice(0, index + 1)) as string, end: index + 1 };
  } catch {
    return null;
  }
}

function singleQuoted(source: string): QuotedScalar | null {
  let index = 1;
  while (index < source.length) {
    if (source[index] === "'" && source[index + 1] === "'") index += 2;
    else if (source[index] === "'") break;
    else index += 1;
  }
  if (index >= source.length) return null;
  return { value: source.slice(1, index).replaceAll("''", "'"), end: index + 1 };
}

export function quotedScalar(source: string): QuotedScalar | null {
  if (source.startsWith('"')) return doubleQuoted(source);
  if (source.startsWith("'")) return singleQuoted(source);
  return null;
}

function newlineAt(text: string, at: number): number {
  if (text.startsWith("\r\n", at)) return 2;
  return text.startsWith("\n", at) ? 1 : 0;
}

export function splitFrontMatter(text: string): FrontMatter | null {
  const { frontmatter } = splitMarkdownFrontMatter(text);
  if (!frontmatter) return null;
  const bodyFrom = frontmatter.length + newlineAt(text, frontmatter.length);
  return { lines: frontmatter.split(LINE_BREAK).slice(1, -1), body: text.slice(bodyFrom), bodyFrom };
}

export function frontMatterBody(text: string): string {
  return splitFrontMatter(text)?.body ?? text;
}

function blankFreeEnd(line: string, end: number): number {
  let at = end;
  while (at > 0 && (line[at - 1] === " " || line[at - 1] === "\t")) at -= 1;
  return at;
}

export function frontMatterKey(line: string): string | null {
  if (NOT_A_KEY.test(line)) return null;
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const next = line[colon + 1];
  if (next !== undefined && next !== " " && next !== "\t") return null;
  const raw = line.slice(0, blankFreeEnd(line, colon));
  const key = QUOTED_KEY.exec(raw)?.[2] ?? raw;
  return key === "" ? null : key;
}

function frontMatterRawValue(line: string): string {
  const colon = line.indexOf(":");
  return colon < 0 ? "" : line.slice(colon + 1).trim();
}

function frontMatterScalar(raw: string): string | null {
  const source = raw.trim();
  let value: string | null;
  if (source.startsWith('"') || source.startsWith("'")) value = quotedScalar(source)?.value ?? null;
  else if (source.startsWith("#")) value = null;
  else value = source.slice(0, COMMENT.exec(source)?.index ?? source.length);
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

export function frontMatterValues(text: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const line of splitFrontMatter(text)?.lines ?? []) {
    const key = frontMatterKey(line);
    if (key === null) continue;
    const value = frontMatterScalar(frontMatterRawValue(line));
    if (value === null) values.delete(key);
    else values.set(key, value);
  }
  return values;
}
