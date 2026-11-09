import { currentLocale } from "@/i18n";

const MAX_CACHED_FORMATS = 64;
const formats = new Map<string, unknown>();

function cachedFormat<T>(kind: string, options: object | undefined, create: (locale: string) => T): T {
  const locale = currentLocale();
  const key = `${kind}\u0000${locale}\u0000${JSON.stringify(options ?? null)}`;
  const cached = formats.get(key);
  if (cached) return cached as T;
  const created = create(locale);
  if (formats.size >= MAX_CACHED_FORMATS) formats.clear();
  formats.set(key, created);
  return created;
}

function dateTimeFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return cachedFormat("date", options, (locale) => new Intl.DateTimeFormat(locale, options));
}

export function formatDate(
  value: Date | number,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  return dateTimeFormat(options).format(value);
}

export function formatTime(
  value: Date | number,
  options: Intl.DateTimeFormatOptions = { timeStyle: "short" },
): string {
  return dateTimeFormat(options).format(value);
}

export function formatDateTime(
  value: Date | number,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
): string {
  return dateTimeFormat(options).format(value);
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return cachedFormat("number", options, (locale) => new Intl.NumberFormat(locale, options)).format(value);
}

const COMPACT_NUMBER: Intl.NumberFormatOptions = { notation: "compact", maximumFractionDigits: 1 };

export function formatCompactNumber(value: number): string {
  return formatNumber(value, COMPACT_NUMBER);
}

const RELATIVE_TIME: Intl.RelativeTimeFormatOptions = { numeric: "auto" };

export function formatRelativeTime(value: number, unit: Intl.RelativeTimeFormatUnit): string {
  return cachedFormat("relative", RELATIVE_TIME, (locale) => new Intl.RelativeTimeFormat(locale, RELATIVE_TIME)).format(
    value,
    unit,
  );
}

export type RelativeTimeUnit = "minute" | "hour" | "day" | "week" | "month" | "year";

export interface RelativeTimeSpan {
  readonly unit: RelativeTimeUnit;
  readonly value: number;
}

export interface RelativeTimeOptions {
  readonly largestUnit?: RelativeTimeUnit;
  readonly dateAfterDays?: number;
  readonly justNow?: string;
  readonly format?: (span: RelativeTimeSpan) => string;
}

const DAY_MS = 86_400_000;

const RELATIVE_TIME_UNITS: readonly (readonly [RelativeTimeUnit, number])[] = [
  ["year", 365 * DAY_MS],
  ["month", 30 * DAY_MS],
  ["week", 7 * DAY_MS],
  ["day", DAY_MS],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

export function relativeTimeSpan(
  timestamp: number,
  now: number = Date.now(),
  largestUnit: RelativeTimeUnit = "year",
): RelativeTimeSpan | null {
  const elapsed = now - timestamp;
  const first = RELATIVE_TIME_UNITS.findIndex(([unit]) => unit === largestUnit);
  for (const [unit, span] of RELATIVE_TIME_UNITS.slice(first)) {
    if (elapsed >= span) return { unit, value: Math.floor(elapsed / span) };
  }
  return null;
}

export function formatRelativeTimeFrom(
  timestamp: number,
  now: number = Date.now(),
  options: RelativeTimeOptions = {},
): string {
  const { largestUnit, dateAfterDays, justNow, format } = options;
  if (dateAfterDays !== undefined && now - timestamp >= dateAfterDays * DAY_MS) {
    return formatDate(timestamp, { dateStyle: "short" });
  }
  const span = relativeTimeSpan(timestamp, now, largestUnit);
  if (!span) return justNow ?? formatRelativeTime(0, "second");
  return format ? format(span) : formatRelativeTime(-span.value, span.unit);
}

const NATURAL_ORDER: Intl.CollatorOptions = { numeric: true, sensitivity: "base" };

export function textCollator(options: Intl.CollatorOptions = NATURAL_ORDER): Intl.Collator {
  return cachedFormat("collator", options, (locale) => new Intl.Collator(locale, options));
}

export function compareText(left: string, right: string): number {
  return textCollator().compare(left, right);
}

export function formatList(items: readonly string[], options?: Intl.ListFormatOptions): string {
  return cachedFormat("list", options, (locale) => new Intl.ListFormat(locale, options)).format(items);
}

export function formatNameList(
  names: readonly string[],
  more: (shown: string, rest: number) => string,
  limit = 5,
): string {
  if (names.length <= limit) return formatList(names);
  const shown = formatList(names.slice(0, limit), { type: "unit", style: "short" });
  return more(shown, names.length - limit);
}
