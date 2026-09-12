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
