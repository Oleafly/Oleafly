export interface Bound {
  readonly value: number;
  readonly inclusive: boolean;
}

export interface Range {
  readonly lower: Bound | null;
  readonly upper: Bound | null;
}

interface Interval {
  readonly start: number;
  readonly end: number;
}

type Comparator = ">" | ">=" | "<" | "<=" | "=";

const COMPARATOR = /^(>=|<=|>|<)/;
const ABSOLUTE_DATE =
  /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?)?)?)?$/i;
const RELATIVE_DATE = /^@today(?:([+-])(\d{1,4})([dwmy]))?$/i;
const NUMBER = /^-?\d+(?:\.\d+)?$/;

export function inRange(value: number, range: Range): boolean {
  const { lower, upper } = range;
  if (lower && (lower.inclusive ? value < lower.value : value <= lower.value)) return false;
  return !upper || (upper.inclusive ? value <= upper.value : value < upper.value);
}

function startOfDay(at: number): Date {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date;
}

function dayAfter(date: Date): number {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  return next.getTime();
}

function shift(date: Date, sign: number, amount: number, unit: string): void {
  const step = sign * amount;
  if (unit === "d") date.setDate(date.getDate() + step);
  else if (unit === "w") date.setDate(date.getDate() + step * 7);
  else if (unit === "m") date.setMonth(date.getMonth() + step);
  else date.setFullYear(date.getFullYear() + step);
}

function relativeDay(text: string, now: number): Interval | null {
  const match = RELATIVE_DATE.exec(text);
  if (!match) return null;
  const day = startOfDay(now);
  if (match[1]) shift(day, match[1] === "-" ? -1 : 1, Number(match[2]), match[3].toLowerCase());
  return { start: day.getTime(), end: dayAfter(day) };
}

function offsetMinutes(zone: string): number {
  if (zone.toUpperCase() === "Z") return 0;
  const digits = zone.replace(":", "");
  const minutes = Number(digits.slice(1, 3)) * 60 + Number(digits.slice(3, 5));
  return zone.startsWith("-") ? -minutes : minutes;
}

function makeTime(parts: readonly number[], zone: string | undefined): number {
  const [year, month, day, hour, minute, second] = parts;
  if (zone === undefined) return new Date(year, month, day, hour, minute, second).getTime();
  return Date.UTC(year, month, day, hour, minute, second) - offsetMinutes(zone) * 60_000;
}

function validCalendar(year: number, month: number, day: number): boolean {
  const date = new Date(year, month, day);
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day;
}

function absoluteDate(text: string): Interval | null {
  const match = ABSOLUTE_DATE.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) - 1 : 0;
  const day = match[3] ? Number(match[3]) : 1;
  const hour = match[4] ? Number(match[4]) : 0;
  const minute = match[5] ? Number(match[5]) : 0;
  const second = match[6] ? Number(match[6]) : 0;
  if (!validCalendar(year, month, day) || hour > 23 || minute > 59 || second > 59) return null;
  const zone = match[7];
  const start = makeTime([year, month, day, hour, minute, second], zone);
  let next: number[];
  if (match[6]) next = [year, month, day, hour, minute, second + 1];
  else if (match[4]) next = [year, month, day, hour, minute + 1, 0];
  else if (match[3]) next = [year, month, day + 1, 0, 0, 0];
  else if (match[2]) next = [year, month + 1, 1, 0, 0, 0];
  else next = [year + 1, 0, 1, 0, 0, 0];
  return { start, end: makeTime(next, zone) };
}

export function parseDate(text: string, now: number): Interval | null {
  return relativeDay(text, now) ?? absoluteDate(text);
}

function parseNumber(text: string): Interval | null {
  if (!NUMBER.test(text)) return null;
  const value = Number(text);
  return { start: value, end: value };
}

function splitComparator(text: string): { comparator: Comparator; rest: string } {
  const match = COMPARATOR.exec(text);
  if (!match) return { comparator: "=", rest: text };
  return { comparator: match[1] as Comparator, rest: text.slice(match[1].length) };
}

function compare(
  comparator: Comparator,
  interval: Interval,
  inclusiveEnd: boolean,
): Range {
  const end: Bound = { value: interval.end, inclusive: inclusiveEnd };
  switch (comparator) {
    case ">":
      return { lower: { value: interval.end, inclusive: !inclusiveEnd }, upper: null };
    case ">=":
      return { lower: { value: interval.start, inclusive: true }, upper: null };
    case "<":
      return { lower: null, upper: { value: interval.start, inclusive: false } };
    case "<=":
      return { lower: null, upper: end };
    default:
      return { lower: { value: interval.start, inclusive: true }, upper: end };
  }
}

function between(
  text: string,
  read: (part: string) => Interval | null,
  inclusiveEnd: boolean,
): Range | null {
  const [from, to, ...extra] = text.split("..");
  if (extra.length > 0 || (from === "*" && to === "*")) return null;
  const lower = from === "*" ? null : read(from);
  const upper = to === "*" ? null : read(to);
  if ((from !== "*" && !lower) || (to !== "*" && !upper)) return null;
  if (lower && upper && lower.start > upper.end) return null;
  return {
    lower: lower ? { value: lower.start, inclusive: true } : null,
    upper: upper ? { value: upper.end, inclusive: inclusiveEnd } : null,
  };
}

function parseRange(
  text: string,
  read: (part: string) => Interval | null,
  inclusiveEnd: boolean,
): Range | null {
  if (text.includes("..")) return between(text, read, inclusiveEnd);
  const { comparator, rest } = splitComparator(text);
  const interval = read(rest);
  return interval ? compare(comparator, interval, inclusiveEnd) : null;
}

export function parseDateRange(text: string, now: number): Range | null {
  return parseRange(text, (part) => parseDate(part, now), false);
}

export function parseNumberRange(text: string): Range | null {
  return parseRange(text, parseNumber, true);
}
