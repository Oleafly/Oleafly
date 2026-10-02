import type { Span, TermToken, ValueItem } from "./lexer";
import { parse, type ParsedQuery, type QueryNode, type SyntaxCode } from "./parser";
import { parseDateRange, parseNumberRange, type Range } from "./ranges";
import {
  normalizeText,
  resolveOption,
  type SearchContext,
  type SearchField,
  type SearchSchema,
} from "./schema";

export type TermCode =
  | "unknown-qualifier"
  | "missing-value"
  | "invalid-value"
  | "invalid-range"
  | "sort-negated";

export interface Diagnostic {
  readonly code: SyntaxCode | TermCode;
  readonly span: Span;
  readonly key?: string;
  readonly value?: string;
}

export type TermRole = "text" | "filter" | "scope" | "sort";

export interface AnalyzedTerm<T, M = unknown> {
  readonly token: TermToken;
  readonly role: TermRole;
  readonly field: SearchField<T, M> | null;
  readonly valid: boolean;
  readonly values: readonly string[];
  readonly ranges: readonly Range[];
}

export interface AnalyzedQuery<T, M = unknown> extends ParsedQuery {
  readonly terms: readonly AnalyzedTerm<T, M>[];
  readonly diagnostics: readonly Diagnostic[];
  termFor(token: TermToken): AnalyzedTerm<T, M> | undefined;
}

function negatedTerms(root: QueryNode | null): Set<TermToken> {
  const negated = new Set<TermToken>();
  const visit = (node: QueryNode, inverted: boolean) => {
    if (node.type === "term") {
      if (inverted) negated.add(node.term);
    } else if (node.type === "not") {
      visit(node.child, !inverted);
    } else {
      for (const child of node.children) visit(child, inverted);
    }
  };
  if (root) visit(root, false);
  return negated;
}

interface Checked {
  readonly values: string[];
  readonly ranges: Range[];
  readonly problems: Diagnostic[];
}

function sortValue<T, M>(schema: SearchSchema<T, M>, text: string): string | undefined {
  const sort = schema.sortOrder(text);
  return sort ? `${sort.order.value}-${sort.descending ? "desc" : "asc"}` : undefined;
}

function checkItem<T, M>(
  item: ValueItem,
  field: SearchField<T, M>,
  schema: SearchSchema<T, M>,
  context: SearchContext,
  sorting: boolean,
): { value?: string; range?: Range } | null {
  if (field.type === "date" || field.type === "number") {
    const range = field.type === "date" ? parseDateRange(item.text, context.now) : parseNumberRange(item.text);
    return range ? { range } : null;
  }
  if (field.type === "text") return { value: normalizeText(item.text) };
  const value = sorting ? sortValue(schema, item.text) : resolveOption(field.options ?? [], item.text)?.value;
  return value ? { value } : null;
}

function checkItems<T, M>(
  token: TermToken,
  field: SearchField<T, M>,
  schema: SearchSchema<T, M>,
  context: SearchContext,
): Checked {
  const checked: Checked = { values: [], ranges: [], problems: [] };
  const key = token.key!.name;
  const sorting = roleOf(field, schema) === "sort";
  for (const item of token.items.filter((candidate) => candidate.text)) {
    const result = checkItem(item, field, schema, context, sorting);
    if (result?.range) checked.ranges.push(result.range);
    else if (result?.value) checked.values.push(result.value);
    else {
      const code = field.type === "date" || field.type === "number" ? "invalid-range" : "invalid-value";
      checked.problems.push({ code, span: item.span, key, value: item.text });
    }
  }
  return checked;
}

function roleOf<T, M>(field: SearchField<T, M>, schema: SearchSchema<T, M>): TermRole {
  if (field === schema.field(schema.sortKey) && field.key === schema.sortKey) return "sort";
  if (field === schema.field(schema.textKey) && field.key === schema.textKey) return "scope";
  return "filter";
}

function analyzeQualifier<T, M>(
  source: string,
  token: TermToken,
  schema: SearchSchema<T, M>,
  context: SearchContext,
  negated: boolean,
  diagnostics: Diagnostic[],
): AnalyzedTerm<T, M> {
  const key = token.key!;
  const field = schema.field(key.name);
  if (!field) {
    diagnostics.push({ code: "unknown-qualifier", span: key.span, key: key.name });
    const text = source.slice(key.span.start, token.span.end);
    return { token, role: "text", field: null, valid: true, values: [normalizeText(text)], ranges: [] };
  }
  const role = roleOf(field, schema);
  const checked = checkItems(token, field, schema, context);
  diagnostics.push(...checked.problems);
  const empty = checked.values.length === 0 && checked.ranges.length === 0;
  if (empty && checked.problems.length === 0) {
    diagnostics.push({ code: "missing-value", span: token.span, key: key.name });
  }
  const misplaced = role === "sort" && negated;
  if (misplaced) diagnostics.push({ code: "sort-negated", span: token.span, key: key.name });
  return {
    token,
    role,
    field,
    valid: !empty && !misplaced,
    values: checked.values,
    ranges: checked.ranges,
  };
}

export function analyze<T, M>(
  source: string,
  schema: SearchSchema<T, M>,
  context: SearchContext,
): AnalyzedQuery<T, M> {
  const parsed = parse(source);
  const diagnostics: Diagnostic[] = parsed.issues.map(({ code, span }) => ({ code, span }));
  const negated = negatedTerms(parsed.root);
  const terms: AnalyzedTerm<T, M>[] = [];
  const byToken = new Map<TermToken, AnalyzedTerm<T, M>>();
  for (const token of parsed.tokens) {
    if (token.kind !== "term" || (!token.key && token.items.length === 0)) continue;
    const term = token.key
      ? analyzeQualifier(source, token, schema, context, negated.has(token), diagnostics)
      : {
          token,
          role: "text" as const,
          field: null,
          valid: token.items[0].text.trim().length > 0,
          values: [normalizeText(token.items[0].text)],
          ranges: [],
        };
    terms.push(term);
    byToken.set(token, term);
  }
  diagnostics.sort((a, b) => a.span.start - b.span.start);
  return { ...parsed, terms, diagnostics, termFor: (token) => byToken.get(token) };
}
