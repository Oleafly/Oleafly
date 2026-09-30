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
