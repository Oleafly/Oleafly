export interface SearchOption<M = unknown> {
  readonly value: string;
  readonly aliases?: readonly string[];
  readonly meta?: M;
}

export interface SearchContext {
  readonly now: number;
}

interface FieldBase<M> {
  readonly key: string;
  readonly aliases?: readonly string[];
  readonly meta?: M;
  readonly hidden?: boolean;
}

export interface EnumField<T, M = unknown> extends FieldBase<M> {
  readonly type: "enum";
  readonly options: readonly SearchOption<M>[];
  readonly test: (item: T, value: string, context: SearchContext) => boolean;
}

export interface TextField<T, M = unknown> extends FieldBase<M> {
  readonly type: "text";
  readonly options?: readonly SearchOption<M>[];
  readonly test: (item: T, needle: string, context: SearchContext) => boolean;
}

export interface RangeField<T, M = unknown> extends FieldBase<M> {
  readonly type: "date" | "number";
  readonly options?: readonly SearchOption<M>[];
  readonly get: (item: T) => number | null | undefined;
}

export type SearchField<T, M = unknown> = EnumField<T, M> | TextField<T, M> | RangeField<T, M>;

export interface TextScope<T, M = unknown> {
  readonly value: string;
  readonly aliases?: readonly string[];
  readonly meta?: M;
  readonly hidden?: boolean;
  readonly get: (item: T) => string | readonly string[] | null | undefined;
}

export interface SortOrder<T, M = unknown> {
  readonly value: string;
  readonly aliases?: readonly string[];
  readonly meta?: M;
  readonly ascendingMeta?: M;
  readonly compare: (a: T, b: T) => number;
}

export interface SearchFlag<T, M = unknown> {
  readonly value: string;
  readonly aliases?: readonly string[];
  readonly meta?: M;
  readonly test: (item: T, context: SearchContext) => boolean;
}

export interface SchemaSpec<T, M = unknown> {
  readonly fields: readonly SearchField<T, M>[];
  readonly text: readonly TextScope<T, M>[];
  readonly textKey?: string;
  readonly textMeta?: M;
  readonly sorts?: readonly SortOrder<T, M>[];
  readonly sortKey?: string;
  readonly sortMeta?: M;
  readonly defaultSort?: string;
}

export interface SearchSchema<T, M = unknown> {
  readonly fields: readonly SearchField<T, M>[];
  readonly text: readonly TextScope<T, M>[];
  readonly sorts: readonly SortOrder<T, M>[];
  readonly defaultSort: string | null;
  field(key: string): SearchField<T, M> | undefined;
  textScope(value: string): TextScope<T, M> | undefined;
  sortOrder(value: string): { order: SortOrder<T, M>; descending: boolean } | undefined;
  readonly sortKey: string;
  readonly textKey: string;
}

export function normalizeText(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

export function resolveOption<O extends { value: string; aliases?: readonly string[] }>(
  options: readonly O[],
  value: string,
): O | undefined {
  const wanted = value.toLowerCase();
  return (
    options.find((option) => option.value.toLowerCase() === wanted) ??
    options.find((option) => option.aliases?.some((alias) => alias.toLowerCase() === wanted))
  );
}

export function flagField<T, M = unknown>(
  key: string,
  flags: readonly SearchFlag<T, M>[],
  extra: Omit<FieldBase<M>, "key"> = {},
): EnumField<T, M> {
  return {
    ...extra,
    key,
    type: "enum",
    options: flags.map(({ value, aliases, meta }) => ({ value, aliases, meta })),
    test: (item, value, context) =>
      flags.find((flag) => flag.value === value)?.test(item, context) ?? false,
  };
}

export function absenceField<T, M = unknown>(
  key: string,
  presence: EnumField<T, M>,
  extra: Omit<FieldBase<M>, "key"> = {},
): EnumField<T, M> {
  return {
    ...extra,
    key,
    type: "enum",
    options: presence.options,
    test: (item, value, context) => !presence.test(item, value, context),
  };
}

const DESCENDING = "-desc";
const ASCENDING = "-asc";

function textField<T, M>(spec: SchemaSpec<T, M>): EnumField<T, M> | null {
  const scopes = spec.text.filter((scope) => !scope.hidden);
  if (scopes.length < 2) return null;
  return {
    key: spec.textKey ?? "in",
    meta: spec.textMeta,
    type: "enum",
    options: scopes.map(({ value, aliases, meta }) => ({ value, aliases, meta })),
    test: () => true,
  };
}

function sortField<T, M>(spec: SchemaSpec<T, M>): EnumField<T, M> | null {
  if (!spec.sorts?.length) return null;
  return {
    key: spec.sortKey ?? "sort",
    meta: spec.sortMeta,
    type: "enum",
    options: spec.sorts.flatMap(({ value, meta, ascendingMeta }) => [
      { value: `${value}${DESCENDING}`, meta },
      { value: `${value}${ASCENDING}`, meta: ascendingMeta ?? meta },
    ]),
    test: () => true,
  };
}

export function defineSchema<T, M = unknown>(spec: SchemaSpec<T, M>): SearchSchema<T, M> {
  const generated = [textField(spec), sortField(spec)].filter(
    (field): field is EnumField<T, M> => field !== null,
  );
  const fields = [...spec.fields, ...generated];
  const byKey = new Map<string, SearchField<T, M>>();
  for (const field of fields) {
    for (const name of [field.key, ...(field.aliases ?? [])]) {
      const key = name.toLowerCase();
      if (byKey.has(key)) throw new Error(`search key "${key}" is defined twice`);
      byKey.set(key, field);
    }
  }
  const sorts = spec.sorts ?? [];
  return {
    fields,
    text: spec.text,
    sorts,
    defaultSort: spec.defaultSort ?? null,
    sortKey: spec.sortKey ?? "sort",
    textKey: spec.textKey ?? "in",
    field: (key) => byKey.get(key.toLowerCase()),
    textScope: (value) => resolveOption(spec.text.filter((scope) => !scope.hidden), value),
    sortOrder(value) {
      const lower = value.toLowerCase();
      const descending = !lower.endsWith(ASCENDING);
      const base = lower.replace(/-(?:asc|desc)$/, "");
      const order = resolveOption(sorts, base);
      return order ? { order, descending } : undefined;
    },
  };
}
