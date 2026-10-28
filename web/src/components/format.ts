import { useEffect, useState } from "react";
import type { WebPerson } from "../protocol";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

export function relativeTime(at: number, now: number, locale?: string): string {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const seconds = Math.round((at - now) / 1000);
  const size = Math.abs(seconds);
  for (const [unit, length] of UNITS) {
    if (size >= length) return format.format(Math.trunc(seconds / length), unit);
  }
  return format.format(0, "second");
}

export function dateTime(at: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(at));
}

export function isoTime(at: number): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function knownName(people: Readonly<Record<string, WebPerson>>, accountId: string): string | null {
  return people[accountId]?.name || null;
}
