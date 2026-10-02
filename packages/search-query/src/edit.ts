import type { AnalyzedQuery, AnalyzedTerm } from "./analyze";
import type { Span, Token } from "./lexer";
import type { QueryNode } from "./parser";

const NEEDS_QUOTES = /[\s(),"]/;

export function formatValue(value: string): string {
  const clean = value.replaceAll('"', "");
  return clean === "" || NEEDS_QUOTES.test(clean) ? `"${clean}"` : clean;
}

export interface TermSpec {
  readonly key: string;
  readonly values: readonly string[];
  readonly negated?: boolean;
}

export function formatTerm({ key, values, negated }: TermSpec): string {
  return `${negated ? "-" : ""}${key}:${values.map(formatValue).join(",")}`;
}

function topLevelNodes(root: QueryNode | null): readonly QueryNode[] {
  if (!root) return [];
  return root.type === "and" ? root.children : [root];
}

interface SimpleTerm<T, M> {
  readonly node: QueryNode;
  readonly term: AnalyzedTerm<T, M>;
  readonly negated: boolean;
}

function simpleTerm<T, M>(node: QueryNode, query: AnalyzedQuery<T, M>): SimpleTerm<T, M> | null {
  const negated = node.type === "not";
  const leaf = negated ? node.child : node;
  if (leaf.type !== "term") return null;
  const term = query.termFor(leaf.term);
  return term ? { node, term, negated } : null;
}

function hasTopLevelOr(tokens: readonly Token[]): boolean {
  let depth = 0;
  for (const token of tokens) {
    if (token.kind === "open") depth += 1;
    else if (token.kind === "close") depth = Math.max(0, depth - 1);
    else if (token.kind === "or" && depth === 0) return true;
  }
  return false;
}

export function removeSpans(source: string, spans: readonly Span[]): string {
  let result = source;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    let start = span.start;
    let end = span.end;
    while (end < result.length && /\s/.test(result[end])) end += 1;
    if (end === result.length) {
      while (start > 0 && /\s/.test(result[start - 1])) start -= 1;
    }
    result = result.slice(0, start) + result.slice(end);
  }
  return result;
}

export function appendTerm<T, M>(source: string, query: AnalyzedQuery<T, M>, term: string): string {
  const base = source.trimEnd();
  if (!base) return term;
  if (hasTopLevelOr(query.tokens)) return `(${base}) ${term}`;
  return `${base} ${term}`;
}

export interface FacetOption {
  readonly id: string;
  readonly term: TermSpec;
}

export interface Facet {
  readonly keys: readonly string[];
  readonly values?: readonly string[];
  readonly options: readonly FacetOption[];
}

export type FacetState =
  | { readonly kind: "none" }
  | { readonly kind: "option"; readonly id: string }
  | { readonly kind: "custom" };

function owned<T, M>(term: AnalyzedTerm<T, M>, facet: Facet): boolean {
  if (term.role !== "filter" && term.role !== "sort") return false;
  const key = term.field?.key;
  if (!key || !facet.keys.includes(key)) return false;
  if (!facet.values) return true;
  return term.token.items.some((item) => facet.values!.includes(item.text.toLowerCase())) ||
    term.values.some((value) => facet.values!.includes(value));
}

function sameValues<T, M>(term: AnalyzedTerm<T, M>, wanted: readonly string[]): boolean {
  const have = term.field?.type === "enum" ? term.values : term.token.items.map((item) => item.text.toLowerCase());
  return have.length === wanted.length && wanted.every((value) => have.includes(value.toLowerCase()));
}

function matchesOption<T, M>(simple: SimpleTerm<T, M>, option: FacetOption): boolean {
  return (
    simple.term.field?.key === option.term.key &&
    simple.negated === Boolean(option.term.negated) &&
    sameValues(simple.term, option.term.values)
  );
}

export function readFacet<T, M>(query: AnalyzedQuery<T, M>, facet: Facet): FacetState {
  const all = query.terms.filter((term) => owned(term, facet));
  if (all.length === 0) return { kind: "none" };
  if (all.length > 1) return { kind: "custom" };
  const simple = topLevelNodes(query.root)
    .map((node) => simpleTerm(node, query))
    .find((candidate) => candidate?.term === all[0]);
  const option = simple ? facet.options.find((candidate) => matchesOption(simple, candidate)) : undefined;
  return option ? { kind: "option", id: option.id } : { kind: "custom" };
}

export function writeFacet<T, M>(
  source: string,
  query: AnalyzedQuery<T, M>,
  facet: Facet,
  optionId: string | null,
): string {
  const spans = topLevelNodes(query.root)
    .map((node) => simpleTerm(node, query))
    .filter((simple): simple is SimpleTerm<T, M> => simple !== null && owned(simple.term, facet))
    .map((simple) => simple.node.span);
  const option = facet.options.find((candidate) => candidate.id === optionId);
  const remaining = removeSpans(source, spans);
  return option ? appendTerm(remaining, query, formatTerm(option.term)) : remaining;
}

function containsQualifier<T, M>(node: QueryNode, query: AnalyzedQuery<T, M>): boolean {
  if (node.type === "term") return query.termFor(node.term)?.role !== "text";
  if (node.type === "not") return containsQualifier(node.child, query);
  return node.children.some((child) => containsQualifier(child, query));
}

export function clearQualifiers<T, M>(source: string, query: AnalyzedQuery<T, M>): string {
  const spans = topLevelNodes(query.root)
    .filter((node) => containsQualifier(node, query))
    .map((node) => node.span);
  return removeSpans(source, spans).trim();
}
