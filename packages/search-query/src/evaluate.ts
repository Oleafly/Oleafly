import type { AnalyzedQuery, AnalyzedTerm } from "./analyze";
import type { QueryNode } from "./parser";
import { inRange } from "./ranges";
import {
  normalizeText,
  type SearchContext,
  type SearchSchema,
  type SortOrder,
  type TextScope,
} from "./schema";

type Predicate<T> = (item: T) => boolean;

export interface ActiveSort<T, M = unknown> {
  readonly order: SortOrder<T, M>;
  readonly descending: boolean;
  readonly value: string;
}

export interface CompiledQuery<T, M = unknown> {
  readonly test: Predicate<T>;
  readonly sort: ActiveSort<T, M> | null;
  readonly filtered: boolean;
}

function scopesFor<T, M>(query: AnalyzedQuery<T, M>, schema: SearchSchema<T, M>): readonly TextScope<T, M>[] {
  const chosen = query.terms
    .filter((term) => term.role === "scope" && term.valid && !term.token.negation)
    .flatMap((term) => term.values)
    .map((value) => schema.textScope(value))
    .filter((scope): scope is TextScope<T, M> => scope !== undefined);
  return chosen.length > 0 ? [...new Set(chosen)] : schema.text;
}

function haystackOf<T, M>(scopes: readonly TextScope<T, M>[]): (item: T) => string {
  const cache = new Map<T, string>();
  return (item) => {
    let text = cache.get(item);
    if (text === undefined) {
      text = normalizeText(
        scopes
          .flatMap((scope) => {
            const value = scope.get(item);
            if (value == null) return [];
            return typeof value === "string" ? [value] : value;
          })
          .join("\n"),
      );
      cache.set(item, text);
    }
    return text;
  };
}

function termPredicate<T, M>(
  term: AnalyzedTerm<T, M> | undefined,
  context: SearchContext,
  haystack: (item: T) => string,
): Predicate<T> | null {
  if (!term?.valid) return null;
  if (term.role === "text") {
    const [needle] = term.values;
    return (item) => haystack(item).includes(needle);
  }
  const field = term.field;
  if (term.role !== "filter" || !field) return null;
  if (field.type === "enum" || field.type === "text") {
    const test = field.test;
    return (item) => term.values.some((value) => test(item, value, context));
  }
  const get = field.get;
  return (item) => {
    const value = get(item);
    return value != null && term.ranges.some((range) => inRange(value, range));
  };
}

function combine<T>(predicates: readonly Predicate<T>[], every: boolean): Predicate<T> | null {
  if (predicates.length === 0) return null;
  if (predicates.length === 1) return predicates[0];
  return every
    ? (item) => predicates.every((predicate) => predicate(item))
    : (item) => predicates.some((predicate) => predicate(item));
}

function build<T, M>(
  node: QueryNode,
  query: AnalyzedQuery<T, M>,
  context: SearchContext,
  haystack: (item: T) => string,
): Predicate<T> | null {
  if (node.type === "term") return termPredicate(query.termFor(node.term), context, haystack);
  if (node.type === "not") {
    const inner = build(node.child, query, context, haystack);
    return inner ? (item) => !inner(item) : null;
  }
  const parts = node.children
    .map((child) => build(child, query, context, haystack))
    .filter((part): part is Predicate<T> => part !== null);
  return combine(parts, node.type === "and");
}

function activeSort<T, M>(query: AnalyzedQuery<T, M>, schema: SearchSchema<T, M>): ActiveSort<T, M> | null {
  const chosen = query.terms.filter((term) => term.role === "sort" && term.valid).at(-1)?.values[0];
  const value = chosen ?? schema.defaultSort;
  if (!value) return null;
  const resolved = schema.sortOrder(value);
  return resolved ? { ...resolved, value } : null;
}

export function compile<T, M>(
  query: AnalyzedQuery<T, M>,
  schema: SearchSchema<T, M>,
  context: SearchContext,
): CompiledQuery<T, M> {
  const haystack = haystackOf(scopesFor(query, schema));
  const predicate = query.root ? build(query.root, query, context, haystack) : null;
  return { test: predicate ?? (() => true), sort: activeSort(query, schema), filtered: predicate !== null };
}

export function sortItems<T, M>(items: readonly T[], sort: ActiveSort<T, M> | null): T[] {
  if (!sort) return [...items];
  const direction = sort.descending ? -1 : 1;
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => direction * sort.order.compare(a.item, b.item) || a.index - b.index)
    .map(({ item }) => item);
}

export function runQuery<T, M>(
  items: readonly T[],
  query: AnalyzedQuery<T, M>,
  schema: SearchSchema<T, M>,
  context: SearchContext,
): T[] {
  const compiled = compile(query, schema, context);
  return sortItems(items.filter(compiled.test), compiled.sort);
}
