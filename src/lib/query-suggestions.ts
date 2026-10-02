import type { ReactNode } from "react";
import {
  normalizeText,
  type SearchOption,
  type SearchSchema,
  type SuggestContext,
} from "@oleafly/search-query";

export interface QueryMeta {
  readonly label: string;
  readonly icon?: ReactNode;
}

export type QuerySuggestion =
  | { readonly id: string; readonly kind: "field"; readonly key: string; readonly meta?: QueryMeta }
  | { readonly id: string; readonly kind: "value"; readonly value: string; readonly meta?: QueryMeta }
  | { readonly id: string; readonly kind: "operator"; readonly operator: "AND" | "OR" }
  | { readonly id: string; readonly kind: "exclude" }
  | { readonly id: string; readonly kind: "negate"; readonly negated: boolean; readonly meta?: QueryMeta };

export interface QuerySuggestions {
  readonly heading: "exclude" | null;
  readonly items: readonly QuerySuggestion[];
  readonly operators: readonly QuerySuggestion[];
  readonly hint: "date" | "number" | null;
}

const NONE: QuerySuggestions = { heading: null, items: [], operators: [], hint: null };
const AND: QuerySuggestion = { id: "operator:and", kind: "operator", operator: "AND" };
const OR: QuerySuggestion = { id: "operator:or", kind: "operator", operator: "OR" };
const EXCLUDE: QuerySuggestion = { id: "operator:exclude", kind: "exclude" };

function rank(prefix: string, names: readonly (string | undefined)[]): number {
  if (!prefix) return 0;
  const wanted = normalizeText(prefix);
  let best = -1;
  for (const name of names) {
    if (!name) continue;
    const have = normalizeText(name);
    if (have.startsWith(wanted)) return 0;
    if (have.includes(wanted)) best = 1;
  }
  return best;
}

function ranked<X>(entries: readonly X[], prefix: string, names: (entry: X) => (string | undefined)[]): X[] {
  return entries
    .map((entry, index) => ({ entry, index, rank: rank(prefix, names(entry)) }))
    .filter((candidate) => candidate.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((candidate) => candidate.entry);
}

function optionNames(option: SearchOption<QueryMeta>): (string | undefined)[] {
  return [option.value, ...(option.aliases ?? []), option.meta?.label];
}

export function buildSuggestions<T>(
  context: SuggestContext<T, QueryMeta>,
  schema: SearchSchema<T, QueryMeta>,
): QuerySuggestions {
  if (context.kind === "none") return NONE;
  if (context.kind === "values") {
    const field = context.field;
    if (!field) return NONE;
    const options = (field.options ?? []).filter((option) => !context.taken.includes(option.value.toLowerCase()));
    const values = ranked(options, context.prefix, optionNames).map(
      (option): QuerySuggestion => ({ id: `value:${option.value}`, kind: "value", value: option.value, meta: option.meta }),
    );
    const negatable = field !== schema.field(schema.sortKey) && field !== schema.field(schema.textKey);
    const items: QuerySuggestion[] =
      negatable && !context.prefix
        ? [{ id: "negate", kind: "negate", negated: context.negation !== null, meta: field.meta }, ...values]
        : values;
    const hint = field.type === "date" || field.type === "number" ? field.type : null;
    return { heading: null, items, operators: [], hint };
  }
  const fields = ranked(
    schema.fields.filter((field) => !field.hidden),
    context.prefix,
    (field) => [field.key, ...(field.aliases ?? []), field.meta?.label],
  ).map((field): QuerySuggestion => ({ id: `field:${field.key}`, kind: "field", key: field.key, meta: field.meta }));
  const operators: QuerySuggestion[] = [];
  if (!context.prefix && !context.negated) {
    if (context.operators) operators.push(AND, OR);
    operators.push(EXCLUDE);
  }
  return { heading: context.negated ? "exclude" : null, items: fields, operators, hint: null };
}
