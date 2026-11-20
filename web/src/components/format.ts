const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

const relativeFormats = new Map<string, Intl.RelativeTimeFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

function cached<T>(formats: Map<string, T>, locale: string | undefined, create: () => T): T {
  const key = locale ?? "";
  const known = formats.get(key);
  if (known) return known;
  const made = create();
  formats.set(key, made);
  return made;
}

export function relativeTime(at: number, now: number, locale?: string): string {
  const format = cached(relativeFormats, locale, () => new Intl.RelativeTimeFormat(locale, { numeric: "auto" }));
  const seconds = Math.round((at - now) / 1000);
  const size = Math.abs(seconds);
  for (const [unit, length] of UNITS) {
    if (size >= length) return format.format(Math.trunc(seconds / length), unit);
  }
  return format.format(0, "second");
}

export function dateTime(at: number, locale?: string): string {
  return cached(dateFormats, locale, () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" })).format(
    new Date(at),
  );
}
