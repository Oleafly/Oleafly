export type PeriodicKind = "daily" | "weekly" | "monthly";

export interface PeriodicNoteSettings {
  enabled: boolean;
  format: string;
  template: string;
  tag: string;
}

export type WeekStartSetting = "locale" | "monday" | "sunday" | "saturday";
export type WeekDay = 0 | 1 | 6;

export type NotesPeriodic = Readonly<Record<PeriodicKind, PeriodicNoteSettings> & { weekStart: WeekStartSetting }>;

export const PERIODIC_KINDS: readonly PeriodicKind[] = ["daily", "weekly", "monthly"];
export const WEEK_START_SETTINGS: readonly WeekStartSetting[] = ["locale", "monday", "sunday", "saturday"];
export const NOTES_PERIODIC_KEY = "oleafly.notes.periodic";
export const BUILT_IN_TEMPLATE = "builtin:";
export const NOTE_TEMPLATE = "note:";
export const FORMAT_LIMIT = 64;
export const TAG_LIMIT = 48;

export const NOTES_PERIODIC_DEFAULTS: NotesPeriodic = {
  daily: { enabled: true, format: "YYYY-MM-DD", template: `${BUILT_IN_TEMPLATE}daily`, tag: "daily" },
  weekly: { enabled: true, format: "GGGG-[W]WW", template: `${BUILT_IN_TEMPLATE}weeklyLog`, tag: "weekly" },
  monthly: { enabled: true, format: "YYYY-MM", template: "", tag: "monthly" },
  weekStart: "locale",
};

const WEEK_DAYS: Readonly<Record<Exclude<WeekStartSetting, "locale">, WeekDay>> = { monday: 1, sunday: 0, saturday: 6 };
const SUNDAY_REGIONS = new Set(
  "AG AS BD BR BS BT BW BZ CA CO DM DO ET GT GU HK HN ID IL IN JM JP KE KH KR LA MH MM MO MT MX MZ NI NP PA PE PH PK PR PT PY SA SG SV TH TT TW UM US VE VI WS YE ZA ZW".split(" "),
);
const SATURDAY_REGIONS = new Set("AE AF BH DJ DZ EG IQ IR JO KW LY OM QA SD SY".split(" "));

const FORMAT_TOKENS = ["YYYY", "GGGG", "gggg", "YY", "GG", "gg", "MMMM", "MMM", "MM", "M", "DD", "D", "dddd", "ddd", "d", "WW", "W", "ww", "w", "Q"];
const PLAIN_TAG = /^[\p{L}\p{N}_\-/]*$/u;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, fallback: string, limit: number): string {
  return typeof value === "string" ? value.slice(0, limit) : fallback;
}

interface FormatPart {
  value: string;
  token: boolean;
}

function formatPartAt(format: string, at: number, close: number): FormatPart & { end: number } {
  if (format[at] === "[" && close > at) return { value: format.slice(at + 1, close), token: false, end: close + 1 };
  const token = FORMAT_TOKENS.find((candidate) => format.startsWith(candidate, at));
  if (token) return { value: token, token: true, end: at + token.length };
  return { value: format.charAt(at), token: false, end: at + 1 };
}

function formatParts(format: string): FormatPart[] {
  const parts: FormatPart[] = [];
  let close = format.indexOf("]");
  let at = 0;
  while (at < format.length) {
    if (close !== -1 && close <= at) close = format.indexOf("]", at + 1);
    const part = formatPartAt(format, at, close);
    parts.push(part);
    at = part.end;
  }
  return parts;
}

export function validPeriodFormat(format: string): boolean {
  return formatParts(format).some((part) => part.token);
}

export function cleanTag(tag: string): string {
  const trimmed = tag.trim().replace(/^#+/u, "");
  return PLAIN_TAG.test(trimmed) ? trimmed.slice(0, TAG_LIMIT) : "";
}

function settingsOf(value: unknown, fallback: PeriodicNoteSettings): PeriodicNoteSettings {
  const raw = record(value);
  const format = text(raw.format, fallback.format, FORMAT_LIMIT);
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : fallback.enabled,
    format: validPeriodFormat(format) ? format : fallback.format,
    template: text(raw.template, fallback.template, 256),
    tag: typeof raw.tag === "string" ? cleanTag(raw.tag) : fallback.tag,
  };
}

export function normalizePeriodic(value: unknown): NotesPeriodic {
  const raw = record(value);
  return {
    daily: settingsOf(raw.daily, NOTES_PERIODIC_DEFAULTS.daily),
    weekly: settingsOf(raw.weekly, NOTES_PERIODIC_DEFAULTS.weekly),
    monthly: settingsOf(raw.monthly, NOTES_PERIODIC_DEFAULTS.monthly),
    weekStart: WEEK_START_SETTINGS.find((setting) => setting === raw.weekStart) ?? NOTES_PERIODIC_DEFAULTS.weekStart,
  };
}

interface WeekInfo {
  firstDay?: number;
}

type LocaleWithWeek = Intl.Locale & { getWeekInfo?: () => WeekInfo; weekInfo?: WeekInfo };

function systemLocales(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language];
}

function parsedLocale(tag: string): Intl.Locale | null {
  try {
    return new Intl.Locale(tag);
  } catch {
    return null;
  }
}

function regionalLocale(locale: string, system: readonly string[]): string {
  const ui = parsedLocale(locale);
  if (!ui || ui.region) return locale;
  return (
    system.find((tag) => {
      const own = parsedLocale(tag);
      return own?.language === ui.language && own.region !== undefined;
    }) ?? locale
  );
}

export function localeWeekStart(locale: string, system: readonly string[] = systemLocales()): WeekDay {
  const parsed = parsedLocale(regionalLocale(locale, system)) as LocaleWithWeek | null;
  if (!parsed) return 1;
  const first = parsed.getWeekInfo?.().firstDay ?? parsed.weekInfo?.firstDay;
  if (first === 7) return 0;
  if (first === 1 || first === 6) return first;
  const region = parsed.maximize().region ?? "";
  if (SUNDAY_REGIONS.has(region)) return 0;
  return SATURDAY_REGIONS.has(region) ? 6 : 1;
}

export function resolveWeekStart(setting: WeekStartSetting, locale: string): WeekDay {
  return setting === "locale" ? localeWeekStart(locale) : WEEK_DAYS[setting];
}

export function readPeriodic(raw: string | null): NotesPeriodic {
  if (!raw) return NOTES_PERIODIC_DEFAULTS;
  try {
    return normalizePeriodic(JSON.parse(raw));
  } catch {
    return NOTES_PERIODIC_DEFAULTS;
  }
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function isoWeekday(date: Date): number {
  return (date.getDay() + 6) % 7;
}

export function weekStart(date: Date, first: WeekDay = 1): Date {
  return addDays(date, -((date.getDay() - first + 7) % 7));
}

export function isoWeek(date: Date): { year: number; week: number } {
  const thursday = addDays(date, 3 - isoWeekday(date));
  const ordinal = Math.round((thursday.getTime() - new Date(thursday.getFullYear(), 0, 1).getTime()) / 86_400_000);
  return { year: thursday.getFullYear(), week: Math.floor(ordinal / 7) + 1 };
}

export function weekNumber(date: Date, first: WeekDay = 1): { year: number; week: number } {
  if (first === 1) return isoWeek(date);
  const start = weekStart(date, first);
  const end = addDays(start, 6);
  if (end.getFullYear() !== start.getFullYear()) return { year: end.getFullYear(), week: 1 };
  const firstWeek = weekStart(new Date(start.getFullYear(), 0, 1), first);
  return { year: start.getFullYear(), week: Math.round((start.getTime() - firstWeek.getTime()) / (7 * 86_400_000)) + 1 };
}

export function periodStart(kind: PeriodicKind, date: Date, first: WeekDay = 1): Date {
  if (kind === "weekly") return weekStart(date, first);
  if (kind === "monthly") return new Date(date.getFullYear(), date.getMonth(), 1);
  return startOfDay(date);
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

function name(date: Date, locale: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale, options).format(date);
}

function tokenValue(token: string, date: Date, locale: string, week: ReturnType<typeof weekNumber>): string {
  switch (token) {
    case "YYYY":
      return String(date.getFullYear());
    case "YY":
      return pad(date.getFullYear() % 100);
    case "GGGG":
    case "gggg":
      return String(week.year);
    case "GG":
    case "gg":
      return pad(week.year % 100);
    case "MMMM":
      return name(date, locale, { month: "long" });
    case "MMM":
      return name(date, locale, { month: "short" });
    case "MM":
      return pad(date.getMonth() + 1);
    case "M":
      return String(date.getMonth() + 1);
    case "DD":
      return pad(date.getDate());
    case "D":
      return String(date.getDate());
    case "dddd":
      return name(date, locale, { weekday: "long" });
    case "ddd":
      return name(date, locale, { weekday: "short" });
    case "d":
      return String(date.getDay());
    case "WW":
    case "ww":
      return pad(week.week);
    case "W":
    case "w":
      return String(week.week);
    default:
      return String(Math.floor(date.getMonth() / 3) + 1);
  }
}

export function formatPeriodTitle(format: string, date: Date, locale: string, first: WeekDay = 1): string {
  const week = weekNumber(date, first);
  return formatParts(format)
    .map((part) => (part.token ? tokenValue(part.value, date, locale, week) : part.value))
    .join("");
}

export function periodTitle(kind: PeriodicKind, settings: NotesPeriodic, date: Date, locale: string): string {
  const first = resolveWeekStart(settings.weekStart, locale);
  return formatPeriodTitle(settings[kind].format, periodStart(kind, date, first), locale, first);
}

function escaped(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function names(locale: string, options: Intl.DateTimeFormatOptions, dates: readonly Date[]): string[] {
  return dates.map((date) => name(date, locale, options));
}

const MONTHS = Array.from({ length: 12 }, (_, month) => new Date(2026, month, 1));
const WEEKDAYS = Array.from({ length: 7 }, (_, offset) => new Date(2026, 0, 4 + offset));

export function weekdayName(day: number, locale: string): string {
  return name(WEEKDAYS[day], locale, { weekday: "long" });
}

type DayPart = "year" | "shortYear" | "month" | "day";

interface TokenPattern {
  pattern: string;
  part?: DayPart;
  names?: readonly string[];
}

function tokenPattern(token: string, locale: string): TokenPattern {
  const listed = (list: readonly string[], part?: DayPart): TokenPattern => ({ pattern: list.map(escaped).join("|"), part, names: list });
  switch (token) {
    case "YYYY":
      return { pattern: String.raw`\d{4}`, part: "year" };
    case "YY":
      return { pattern: String.raw`\d{2}`, part: "shortYear" };
    case "MM":
      return { pattern: String.raw`\d{2}`, part: "month" };
    case "M":
      return { pattern: String.raw`\d{1,2}`, part: "month" };
    case "DD":
      return { pattern: String.raw`\d{2}`, part: "day" };
    case "D":
      return { pattern: String.raw`\d{1,2}`, part: "day" };
    case "MMMM":
      return listed(names(locale, { month: "long" }, MONTHS), "month");
    case "MMM":
      return listed(names(locale, { month: "short" }, MONTHS), "month");
    case "dddd":
      return listed(names(locale, { weekday: "long" }, WEEKDAYS));
    case "ddd":
      return listed(names(locale, { weekday: "short" }, WEEKDAYS));
    default:
      return { pattern: String.raw`\d{1,4}` };
  }
}

function partValue(pattern: TokenPattern, value: string): number {
  if (pattern.names) return pattern.names.indexOf(value) + 1;
  return pattern.part === "shortYear" ? 2000 + Number(value) : Number(value);
}

export function parseDayTitle(format: string, title: string, locale: string, first: WeekDay = 1): Date | null {
  const groups: TokenPattern[] = [];
  const source = formatParts(format)
    .map((part) => {
      if (!part.token) return escaped(part.value);
      const pattern = tokenPattern(part.value, locale);
      if (pattern.part) groups.push(pattern);
      return pattern.part ? `(${pattern.pattern})` : `(?:${pattern.pattern})`;
    })
    .join("");
  const found = new RegExp(`^${source}$`, "u").exec(title);
  if (!found) return null;
  const parts: Partial<Record<"year" | "month" | "day", number>> = {};
  groups.forEach((pattern, index) => {
    const part = pattern.part === "shortYear" ? "year" : pattern.part;
    if (part) parts[part] = partValue(pattern, found[index + 1]);
  });
  if (parts.year === undefined || parts.month === undefined || parts.day === undefined) return null;
  const date = new Date(parts.year, parts.month - 1, parts.day);
  return formatPeriodTitle(format, date, locale, first) === title ? date : null;
}
