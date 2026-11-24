import { scanMathEnvironments, scanMathExpressions } from "@oleafly/editor/math-source";

export type CommentInline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold" | "italic" | "strike"; children: CommentInline[] }
  | { kind: "link"; href: string; text: string }
  | { kind: "math"; source: string; body: string; display: boolean };

export interface CommentParseOptions {
  math?: boolean;
  markdown?: boolean;
}

export type CommentBlock =
  | { kind: "paragraph"; children: CommentInline[] }
  | { kind: "bullet"; items: CommentInline[][] }
  | { kind: "ordered"; start: number; items: CommentInline[][] };

export interface TextEdit {
  text: string;
  start: number;
  end: number;
}

const WORD = /[\p{L}\p{N}_]/u;
const URL_AT = /https?:\/\/[^\s<>"'`]+/uy;
const TRAILING = new Set(".,;:!?)]}'\"");
const BULLET = /^[-*] (.*)$/u;
const ORDERED = /^(\d{1,9})\. (.*)$/u;

function isWord(char: string | undefined): boolean {
  return char !== undefined && WORD.test(char);
}

function isSpace(char: string | undefined): boolean {
  return char === undefined || /\s/u.test(char);
}

function closingPair(text: string, from: number, marker: string): number {
  let at = text.indexOf(marker, from);
  while (at !== -1) {
    if (at > from && !isSpace(text[at - 1])) {
      while (text[at + marker.length] === marker[0]) at += 1;
      return at;
    }
    at = text.indexOf(marker, at + 1);
  }
  return -1;
}

function closingStar(text: string, from: number): number {
  for (let at = text.indexOf("*", from); at !== -1; at = text.indexOf("*", at + 1)) {
    if (at > from && !isSpace(text[at - 1]) && text[at - 1] !== "*" && text[at + 1] !== "*") return at;
  }
  return -1;
}

function closingUnderscore(text: string, from: number): number {
  for (let at = text.indexOf("_", from); at !== -1; at = text.indexOf("_", at + 1)) {
    if (at > from && !isSpace(text[at - 1]) && !isWord(text[at + 1])) return at;
  }
  return -1;
}

interface Match {
  node: CommentInline;
  end: number;
}

function formulas(text: string, options: CommentParseOptions): ReadonlyMap<number, Match> {
  if (!options.math || !/[$\\]/u.test(text)) return new Map();
  const environments = text.includes("\\begin{") ? scanMathEnvironments(text) : [];
  return new Map([
    ...environments.map(({ from, to, source }): [number, Match] => [
      from,
      { node: { kind: "math", source, body: source, display: true }, end: to },
    ]),
    ...scanMathExpressions(text, { format: "markdown", excluded: environments })
      .filter((found) => found.status === "complete" && found.body.trim() !== "")
      .map((found): [number, Match] => [
        found.from,
        { node: { kind: "math", source: found.source, body: found.body, display: found.display }, end: found.to },
      ]),
  ]);
}

function escapeAt(text: string, index: number, options: CommentParseOptions): string | null {
  if (!options.math || text[index] !== "\\") return null;
  if (text[index + 1] === "$") return "$";
  return text[index + 1] === "\\" ? "\\\\" : null;
}

function linkAt(text: string, index: number): Match | null {
  if (text[index] !== "h" || isWord(text[index - 1])) return null;
  URL_AT.lastIndex = index;
  const found = URL_AT.exec(text);
  if (!found) return null;
  let end = index + found[0].length;
  while (end > index && TRAILING.has(text[end - 1])) end -= 1;
  const href = text.slice(index, end);
  return href.length > "https://".length ? { node: { kind: "link", href, text: href }, end } : null;
}

function matchAt(text: string, index: number, options: CommentParseOptions): Match | null {
  if (options.markdown === false) return linkAt(text, index);
  const char = text[index];
  if (char === "`") {
    const close = text.indexOf("`", index + 1);
    if (close > index + 1) return { node: { kind: "code", text: text.slice(index + 1, close) }, end: close + 1 };
    return null;
  }
  for (const [marker, kind] of [
    ["**", "bold"],
    ["~~", "strike"],
  ] as const) {
    if (!text.startsWith(marker, index) || isSpace(text[index + 2])) continue;
    const close = closingPair(text, index + 2, marker);
    if (close !== -1) {
      return { node: { kind, children: parseInline(text.slice(index + 2, close), options) }, end: close + 2 };
    }
  }
  if (char === "*" && text[index - 1] !== "*" && text[index + 1] !== "*" && !isSpace(text[index + 1])) {
    const close = closingStar(text, index + 1);
    if (close !== -1) {
      return { node: { kind: "italic", children: parseInline(text.slice(index + 1, close), options) }, end: close + 1 };
    }
  }
  if (char === "_" && !isWord(text[index - 1]) && !isSpace(text[index + 1])) {
    const close = closingUnderscore(text, index + 1);
    if (close !== -1) {
      return { node: { kind: "italic", children: parseInline(text.slice(index + 1, close), options) }, end: close + 1 };
    }
  }
  return linkAt(text, index);
}

export function parseInline(text: string, options: CommentParseOptions = {}): CommentInline[] {
  const nodes: CommentInline[] = [];
  const math = formulas(text, options);
  let plain = "";
  let index = 0;
  while (index < text.length) {
    const match = math.get(index) ?? matchAt(text, index, options);
    const escaped = match ? null : escapeAt(text, index, options);
    if (escaped !== null) {
      plain += escaped;
      index += 2;
      continue;
    }
    if (!match) {
      plain += text[index];
      index += 1;
      continue;
    }
    if (plain) nodes.push({ kind: "text", text: plain });
    plain = "";
    nodes.push(match.node);
    index = match.end;
  }
  if (plain) nodes.push({ kind: "text", text: plain });
  return nodes;
}

export function parseComment(body: string, options: CommentParseOptions = {}): CommentBlock[] {
  const blocks: CommentBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", children: parseInline(paragraph.join("\n"), options) });
    paragraph = [];
  };
  const lists = options.markdown !== false;
  for (const line of body.replaceAll("\r\n", "\n").split("\n")) {
    const bullet = lists ? BULLET.exec(line) : null;
    const ordered = lists ? ORDERED.exec(line) : null;
    const last = blocks.at(-1);
    if (bullet) {
      flush();
      if (last?.kind === "bullet") last.items.push(parseInline(bullet[1], options));
      else blocks.push({ kind: "bullet", items: [parseInline(bullet[1], options)] });
      continue;
    }
    if (ordered) {
      flush();
      if (last?.kind === "ordered") last.items.push(parseInline(ordered[2], options));
      else blocks.push({ kind: "ordered", start: Number(ordered[1]), items: [parseInline(ordered[2], options)] });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks.filter((block) => block.kind !== "paragraph" || block.children.length > 0);
}

function plainInline(nodes: readonly CommentInline[]): string {
  return nodes
    .map((node) => {
      if (node.kind === "text" || node.kind === "code" || node.kind === "link") return node.text;
      if (node.kind === "math") return node.source;
      return plainInline(node.children);
    })
    .join("");
}

export function commentPlainText(body: string, options: CommentParseOptions = {}): string {
  return parseComment(body, options)
    .map((block) => {
      if (block.kind === "paragraph") return plainInline(block.children);
      return block.items
        .map((item, at) => `${block.kind === "ordered" ? `${block.start + at}.` : "-"} ${plainInline(item)}`)
        .join("\n");
    })
    .join("\n");
}

export function wrapSelection(text: string, start: number, end: number, marker: string): TextEdit {
  const size = marker.length;
  if (text.slice(start - size, start) === marker && text.slice(end, end + size) === marker) {
    return {
      text: text.slice(0, start - size) + text.slice(start, end) + text.slice(end + size),
      start: start - size,
      end: end - size,
    };
  }
  const selected = text.slice(start, end);
  return {
    text: `${text.slice(0, start)}${marker}${selected}${marker}${text.slice(end)}`,
    start: start + size,
    end: end + size,
  };
}

export function toggleBullets(text: string, start: number, end: number): TextEdit {
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const newline = text.indexOf("\n", end);
  const to = newline === -1 ? text.length : newline;
  const lines = text.slice(from, to).split("\n");
  const listed = lines.every((line) => BULLET.test(line));
  const next = lines.map((line) => (listed ? line.slice(2) : BULLET.test(line) ? line : `- ${line}`));
  const block = next.join("\n");
  const moved = listed ? -2 : BULLET.test(lines[0]) ? 0 : 2;
  return {
    text: text.slice(0, from) + block + text.slice(to),
    start: Math.max(from, start + moved),
    end: from + block.length - (to - end),
  };
}

export function insertAtCaret(text: string, start: number, end: number, insert: string): TextEdit {
  const before = text.slice(0, start);
  const spaced = before === "" || /\s$/u.test(before) ? insert : ` ${insert}`;
  const caret = start + spaced.length;
  return { text: `${before}${spaced}${text.slice(end)}`, start: caret, end: caret };
}
