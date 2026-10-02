export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface ValueItem {
  readonly text: string;
  readonly span: Span;
  readonly quoted: boolean;
  readonly unterminated: boolean;
}

export interface QualifierKey {
  readonly name: string;
  readonly span: Span;
  readonly colon: Span;
}

export interface TermToken {
  readonly kind: "term";
  readonly span: Span;
  readonly negation: Span | null;
  readonly key: QualifierKey | null;
  readonly items: readonly ValueItem[];
  readonly commas: readonly Span[];
}

export type KeywordKind = "and" | "or" | "not";

export type Token =
  | { readonly kind: "space" | "open" | "close"; readonly span: Span }
  | { readonly kind: KeywordKind; readonly span: Span; readonly dash?: boolean }
  | TermToken;

const KEYWORDS: Readonly<Record<string, KeywordKind>> = { AND: "and", OR: "or", NOT: "not" };
const QUALIFIER_KEY = /^[A-Za-z][\w-]*:/;

function isSpace(char: string | undefined): boolean {
  return char !== undefined && /\s/.test(char);
}

export function isBoundary(char: string | undefined): boolean {
  return char === undefined || char === "(" || char === ")" || isSpace(char);
}

function readQuoted(source: string, start: number): ValueItem {
  const close = source.indexOf('"', start + 1);
  const end = close < 0 ? source.length : close + 1;
  return {
    text: source.slice(start + 1, close < 0 ? source.length : close),
    span: { start, end },
    quoted: true,
    unterminated: close < 0,
  };
}

function readBare(source: string, start: number, stopAtComma: boolean): ValueItem {
  let end = start;
  while (end < source.length && !isBoundary(source[end]) && !(stopAtComma && source[end] === ",")) {
    end += 1;
  }
  return { text: source.slice(start, end), span: { start, end }, quoted: false, unterminated: false };
}

function readItem(source: string, start: number, stopAtComma: boolean): ValueItem {
  return source[start] === '"' ? readQuoted(source, start) : readBare(source, start, stopAtComma);
}

function readValues(source: string, start: number): { items: ValueItem[]; commas: Span[]; end: number } {
  const items: ValueItem[] = [];
  const commas: Span[] = [];
  let at = start;
  let reading = !isBoundary(source[at]);
  while (reading) {
    const item = readItem(source, at, true);
    items.push(item);
    at = item.span.end;
    reading = source[at] === ",";
    if (reading) {
      commas.push({ start: at, end: at + 1 });
      at += 1;
    }
    if (reading && isBoundary(source[at])) {
      items.push({ text: "", span: { start: at, end: at }, quoted: false, unterminated: false });
      reading = false;
    }
  }
  return { items, commas, end: at };
}

function readTerm(source: string, start: number): Token {
  const negated = source[start] === "-";
  const body = negated ? start + 1 : start;
  const negation = negated ? { start, end: body } : null;
  if (negated && isBoundary(source[body])) {
    if (source[body] === "(") return { kind: "not", span: { start, end: body }, dash: true };
    return { kind: "term", span: { start, end: body }, negation, key: null, items: [], commas: [] };
  }
  const qualifier = source[body] === '"' ? null : QUALIFIER_KEY.exec(source.slice(body));
  if (qualifier) {
    const keyEnd = body + qualifier[0].length - 1;
    const values = readValues(source, keyEnd + 1);
    return {
      kind: "term",
      span: { start, end: values.end },
      negation,
      key: {
        name: source.slice(body, keyEnd).toLowerCase(),
        span: { start: body, end: keyEnd },
        colon: { start: keyEnd, end: keyEnd + 1 },
      },
      items: values.items,
      commas: values.commas,
    };
  }
  const item = readItem(source, body, false);
  const keyword = negated || item.quoted ? undefined : KEYWORDS[item.text];
  if (keyword) return { kind: keyword, span: item.span };
  return { kind: "term", span: { start, end: item.span.end }, negation, key: null, items: [item], commas: [] };
}

export function lex(source: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < source.length) {
    const char = source[at];
    if (isSpace(char)) {
      let end = at + 1;
      while (isSpace(source[end])) end += 1;
      tokens.push({ kind: "space", span: { start: at, end } });
      at = end;
    } else if (char === "(" || char === ")") {
      tokens.push({ kind: char === "(" ? "open" : "close", span: { start: at, end: at + 1 } });
      at += 1;
    } else {
      const token = readTerm(source, at);
      tokens.push(token);
      at = token.span.end;
    }
  }
  return tokens;
}
