import { Calendar, CalendarArrowUp, CalendarCheck, CalendarClock, CalendarDays, CalendarPlus, CalendarX, type LucideIcon } from "lucide-react";
import { i18n } from "@/i18n";
import { startOfDay } from "@/lib/notes-periodic";
import "./note-fields.css";

export interface FieldAttrs {
  key: string;
  value: string;
}

export interface InlineField extends FieldAttrs {
  from: number;
  to: number;
}

export type FieldKind = "date" | "priority" | "text";
export type FieldWhen = "past" | "today" | "future";
export type Priority = "highest" | "high" | "medium" | "low" | "lowest";

const PRIORITIES: readonly Priority[] = ["highest", "high", "medium", "low", "lowest"];
export const DUE_KEY = "due";
export const SCHEDULED_KEY = "scheduled";
export const PRIORITY_KEY = "priority";
export const DATE_KEY = "date";

interface KnownKey {
  label: () => string;
  icon?: LucideIcon;
}

const completedLabel = () => i18n.t(($) => $.notes.fields.keys.completed);
const KNOWN_KEYS = new Map<string, KnownKey>([
  [DUE_KEY, { label: () => i18n.t(($) => $.notes.fields.keys.due), icon: Calendar }],
  [SCHEDULED_KEY, { label: () => i18n.t(($) => $.notes.fields.keys.scheduled), icon: CalendarClock }],
  [DATE_KEY, { label: () => i18n.t(($) => $.notes.fields.keys.date), icon: CalendarDays }],
  ["start", { label: () => i18n.t(($) => $.notes.fields.keys.start), icon: CalendarArrowUp }],
  ["created", { label: () => i18n.t(($) => $.notes.fields.keys.created), icon: CalendarPlus }],
  ["completion", { label: completedLabel, icon: CalendarCheck }],
  ["completed", { label: completedLabel, icon: CalendarCheck }],
  ["done", { label: completedLabel, icon: CalendarCheck }],
  ["cancelled", { label: () => i18n.t(($) => $.notes.fields.keys.cancelled), icon: CalendarX }],
  [PRIORITY_KEY, { label: () => i18n.t(($) => $.notes.fields.keys.priority) }],
]);
const DATE_KEYS = new Set([...KNOWN_KEYS].flatMap(([key, known]) => (known.icon ? [key] : [])));
const KEY_SOURCE = String.raw`[\p{L}\p{N}_][\p{L}\p{N}_ \-/.]{0,39}?`;
const VALUE_SOURCE = String.raw`(?:[^[\]\n]|\[\[[^[\]\n]*\]\])*`;
export const FIELD_AT = new RegExp(String.raw`\[(${KEY_SOURCE})::(${VALUE_SOURCE})\]`, "uy");
const FIELDS = new RegExp(String.raw`\[(${KEY_SOURCE})::(${VALUE_SOURCE})\]`, "gu");
export const TYPED = new RegExp(String.raw`\[(${KEY_SOURCE})::(${VALUE_SOURCE})\]$`, "u");
const KEY_ONLY = new RegExp(`^${KEY_SOURCE}$`, "u");
const VALUE_ONLY = new RegExp(`^${VALUE_SOURCE}$`, "u");
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const CODE_SPAN = /(`+)(?:(?!\1)[\s\S])*?\1/gu;
export const OPEN_BRACKET = 0x5b;

export function fieldKey(key: string): string {
  return key.trim().toLowerCase().replaceAll(/\s+/gu, "-");
}

export function fieldValue(value: string): string {
  return value.trim();
}

export function validFieldKey(key: string): boolean {
  return KEY_ONLY.test(key.trim()) && key.trim() === key.trim().replaceAll(/\s{2,}/gu, " ");
}

export function validFieldValue(value: string): boolean {
  return VALUE_ONLY.test(value);
}

export function fieldSource(attrs: FieldAttrs): string {
  return `[${attrs.key}::${attrs.value}]`;
}

export function newField(key: string, value: string): FieldAttrs {
  return { key: key.trim(), value: ` ${value.trim()}` };
}

function withoutCode(text: string): string {
  return text.replaceAll(CODE_SPAN, (span) => "\u0000".repeat(span.length));
}

export function inlineFields(text: string): InlineField[] {
  const masked = withoutCode(text);
  return [...masked.matchAll(FIELDS)].flatMap((match) => {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    if (masked[to] === "(" || masked[to] === "[") return [];
    return [{ key: match[1], value: match[2], from, to }];
  });
}

export function isoDate(value: string): Date | null {
  const match = ISO_DATE.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function dayDistance(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);
}

export function priorityOf(value: string): Priority | null {
  const wanted = value.trim().toLowerCase();
  return PRIORITIES.find((priority) => priority === wanted) ?? null;
}

export function fieldKind(attrs: FieldAttrs): FieldKind {
  if (fieldKey(attrs.key) === PRIORITY_KEY) return priorityOf(attrs.value) ? "priority" : "text";
  return isoDate(attrs.value) ? "date" : "text";
}

export function isDateKey(key: string): boolean {
  return DATE_KEYS.has(fieldKey(key));
}

function formatFieldDate(date: Date, now: Date, locale: string): string {
  const distance = dayDistance(now, date);
  if (distance === 0) return i18n.t(($) => $.notes.fields.today);
  if (distance === 1) return i18n.t(($) => $.notes.fields.tomorrow);
  if (distance === -1) return i18n.t(($) => $.notes.fields.yesterday);
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, sameYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" }).format(date);
}

export function fieldKeyLabel(key: string): string {
  return KNOWN_KEYS.get(fieldKey(key))?.label() ?? key.trim();
}

export function priorityLabel(priority: Priority): string {
  return i18n.t(($) => $.notes.fields.priorities[priority]);
}

export interface FieldDisplay {
  kind: FieldKind;
  fieldKey: string;
  key: string;
  value: string;
  label: string;
  icon: LucideIcon | null;
  when: FieldWhen | null;
  priority: Priority | null;
}

function whenOf(distance: number): FieldWhen {
  if (distance < 0) return "past";
  return distance === 0 ? "today" : "future";
}

export function fieldDisplay(attrs: FieldAttrs, now: Date, locale: string): FieldDisplay {
  const kind = fieldKind(attrs);
  const known = fieldKey(attrs.key);
  const value = fieldValue(attrs.value);
  const date = kind === "date" ? isoDate(value) : null;
  const priority = kind === "priority" ? priorityOf(value) : null;
  let shown = value;
  if (date) shown = formatFieldDate(date, now, locale);
  else if (priority) shown = priorityLabel(priority);
  const key = fieldKeyLabel(attrs.key);
  return {
    kind,
    fieldKey: known,
    key,
    value: shown,
    label: i18n.t(($) => $.notes.fields.chip, { key, value: shown || i18n.t(($) => $.notes.fields.empty) }),
    icon: date ? (KNOWN_KEYS.get(known)?.icon ?? null) : null,
    when: date ? whenOf(dayDistance(now, date)) : null,
    priority,
  };
}

export function fieldData(display: FieldDisplay): Record<string, string | undefined> {
  return {
    "data-kind": display.kind,
    "data-field-key": display.fieldKey,
    "data-priority": display.priority ?? undefined,
    "data-when": display.when ?? undefined,
  };
}
