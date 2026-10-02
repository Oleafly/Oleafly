import { currentLocale } from "@/i18n";

export function formatDate(
  value: Date | number,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
): string {
  return new Intl.DateTimeFormat(currentLocale(), options).format(value);
}

export function formatTime(
  value: Date | number,
  options: Intl.DateTimeFormatOptions = { timeStyle: "short" },
): string {
  return new Intl.DateTimeFormat(currentLocale(), options).format(value);
}

export function formatDateTime(
  value: Date | number,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
): string {
  return new Intl.DateTimeFormat(currentLocale(), options).format(value);
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(currentLocale(), options).format(value);
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat(currentLocale(), { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatRelativeTime(value: number, unit: Intl.RelativeTimeFormatUnit): string {
  return new Intl.RelativeTimeFormat(currentLocale(), { numeric: "auto" }).format(value, unit);
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

export function formatList(items: readonly string[], options?: Intl.ListFormatOptions): string {
  return new Intl.ListFormat(currentLocale(), options).format(items);
}

/**
 * Names joined for a sentence in the active locale. Past `limit`, the first
 * `limit` are joined without the final "and" and passed to `more` with the
 * number left off, which adds the caller's own "and N more".
 */
export function formatNameList(
  names: readonly string[],
  more: (shown: string, rest: number) => string,
  limit = 5,
): string {
  if (names.length <= limit) return formatList(names);
  const shown = formatList(names.slice(0, limit), { type: "unit", style: "short" });
  return more(shown, names.length - limit);
}
