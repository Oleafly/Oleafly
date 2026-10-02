import type { AnalyzedQuery } from "./analyze";
import { formatValue } from "./edit";
import type { Span, TermToken, Token } from "./lexer";
import type { SearchField, SearchSchema } from "./schema";

export interface FieldContext {
  readonly kind: "fields";
  readonly from: number;
  readonly to: number;
  readonly prefix: string;
  readonly negated: boolean;
  readonly operators: boolean;
}

export interface ValueContext<T, M = unknown> {
  readonly kind: "values";
  readonly from: number;
  readonly to: number;
  readonly prefix: string;
  readonly key: string;
  readonly field: SearchField<T, M> | undefined;
  readonly taken: readonly string[];
  readonly keyStart: number;
  readonly negation: Span | null;
}

export type SuggestContext<T, M = unknown> =
  | FieldContext
  | ValueContext<T, M>
  | { readonly kind: "none" };

export interface Edit {
  readonly value: string;
  readonly caret: number;
}

function endsOperand(token: Token | undefined): boolean {
  return token?.kind === "term" || token?.kind === "close";
}

function previousSignificant(tokens: readonly Token[], caret: number): Token | undefined {
  let found: Token | undefined;
  for (const token of tokens) {
    if (token.span.end > caret) break;
    if (token.kind !== "space") found = token;
  }
  return found;
}

function valueContext<T, M>(
  token: TermToken,
  caret: number,
  schema: SearchSchema<T, M>,
  source: string,
): ValueContext<T, M> {
  const key = token.key!;
  const item =
    token.items.find((candidate) => candidate.span.start <= caret && caret <= candidate.span.end) ??
    { text: "", span: { start: caret, end: caret }, quoted: false, unterminated: false };
  const typed = source.slice(item.span.start, caret);
  const prefix = item.quoted ? typed.slice(1) : typed;
  return {
    kind: "values",
    from: item.span.start,
    to: item.span.end,
    prefix,
    key: key.name,
    field: schema.field(key.name),
    taken: token.items.filter((other) => other !== item && other.text).map((other) => other.text.toLowerCase()),
    keyStart: key.span.start,
    negation: token.negation,
  };
}

function termContext<T, M>(
  token: TermToken,
  caret: number,
  schema: SearchSchema<T, M>,
  source: string,
): SuggestContext<T, M> {
  const key = token.key;
  if (key && caret > key.colon.start) return valueContext(token, caret, schema, source);
  if (key) {
    return {
      kind: "fields",
      from: key.span.start,
      to: key.colon.end,
      prefix: source.slice(key.span.start, caret),
      negated: token.negation !== null,
      operators: false,
    };
  }
  const item = token.items[0];
  if (!item) {
    return { kind: "fields", from: caret, to: caret, prefix: "", negated: true, operators: false };
  }
  if (item.quoted) return { kind: "none" };
  return {
    kind: "fields",
    from: item.span.start,
    to: item.span.end,
    prefix: source.slice(item.span.start, caret),
    negated: token.negation !== null,
    operators: false,
  };
}

export function suggestAt<T, M>(
  query: AnalyzedQuery<T, M>,
  schema: SearchSchema<T, M>,
  caret: number,
): SuggestContext<T, M> {
  const inside = query.tokens.find((token) => token.span.start < caret && caret <= token.span.end);
  if (inside?.kind === "term") return termContext(inside, caret, schema, query.source);
  if (inside && inside.kind !== "space" && inside.kind !== "open") return { kind: "none" };
  return {
    kind: "fields",
    from: caret,
    to: caret,
    prefix: "",
    negated: false,
    operators: endsOperand(previousSignificant(query.tokens, caret)),
  };
}

function splice(source: string, from: number, to: number, text: string): string {
  return source.slice(0, from) + text + source.slice(to);
}

export function acceptField(source: string, context: FieldContext, key: string): Edit {
  const text = `${key}:`;
  return { value: splice(source, context.from, context.to, text), caret: context.from + text.length };
}

export function acceptValue<T, M>(source: string, context: ValueContext<T, M>, value: string): Edit {
  const text = formatValue(value);
  const next = source[context.to];
  if (next === ",") {
    return { value: splice(source, context.from, context.to, text), caret: context.from + text.length };
  }
  const spacer = next !== undefined && /\s/.test(next) ? "" : " ";
  return {
    value: splice(source, context.from, context.to, text + spacer),
    caret: context.from + text.length + 1,
  };
}

export function toggleNegation<T, M>(source: string, context: ValueContext<T, M>, caret: number): Edit {
  if (context.negation) {
    const { start, end } = context.negation;
    return { value: source.slice(0, start) + source.slice(end), caret: caret - (end - start) };
  }
  return {
    value: `${source.slice(0, context.keyStart)}-${source.slice(context.keyStart)}`,
    caret: caret + 1,
  };
}

export function insertAtCaret(source: string, caret: number, text: string): Edit {
  const before = caret > 0 && !/\s|\(/.test(source[caret - 1]) ? " " : "";
  const value = source.slice(0, caret) + before + text + source.slice(caret);
  return { value, caret: caret + before.length + text.length };
}
