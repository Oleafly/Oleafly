import {
  frontMatterEntries,
  mergeFrontMatter as mergeEntries,
  readList,
  removeProperty as removeEntry,
  renameProperty as renameEntry,
  setProperty as setEntry,
} from "@/lib/front-matter-yaml";
import type { PropertyType } from "@/store/notes-prefs";
import { parseNoteLink } from "./note-link-format";

export type PropertyValue = string | number | boolean | string[] | null;

export interface NoteProperty {
  key: string;
  type: PropertyType;
  value: PropertyValue;
  readOnly: boolean;
}

export const MANAGED_KEYS: ReadonlySet<string> = new Set(["title", "kind", "id", "icon", "color", "agent"]);
export const LIST_KEYS: ReadonlySet<string> = new Set(["tags", "aliases"]);

const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const LIST_SPLIT: Readonly<Record<string, RegExp>> = { tags: /[,\s]+/u };
const ITEM_SPLIT = /,/u;
const IDENTITY_KEYS: ReadonlySet<string> = new Set(["kind", "id"]);

function isNoteLink(value: unknown): boolean {
  return typeof value === "string" && parseNoteLink(value)?.kind === "note";
}

function asList(value: unknown, key = ""): string[] {
  return readList(value === "" ? null : value, LIST_SPLIT[key] ?? ITEM_SPLIT).map((item) => (key === "tags" ? item.replace(/^#+/u, "") : item)).filter(Boolean);
}

export function inferType(key: string, value: unknown, known?: PropertyType): PropertyType {
  if (LIST_KEYS.has(key)) return "list";
  if (known && compatible(value, known)) return known;
  if (Array.isArray(value)) return "list";
  if (typeof value === "boolean") return "checkbox";
  if (typeof value === "number") return "number";
  if (typeof value === "string" && DATE.test(value)) return "date";
  if (isNoteLink(value)) return "link";
  return "text";
}

function compatible(value: unknown, type: PropertyType): boolean {
  if (value === null || value === undefined || value === "") return true;
  switch (type) {
    case "list":
      return Array.isArray(value);
    case "checkbox":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number";
    case "date":
      return typeof value === "string" && DATE.test(value);
    case "link":
      return isNoteLink(value);
    default:
      return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
  }
}

type ScalarValue = Exclude<PropertyValue, string[]>;

function numberValue(scalar: ScalarValue): number | null {
  const number = typeof scalar === "number" ? scalar : Number.parseFloat(String(scalar ?? ""));
  return Number.isFinite(number) ? number : null;
}

function convertScalar(scalar: ScalarValue, type: PropertyType): PropertyValue {
  switch (type) {
    case "checkbox":
      return scalar === true || (typeof scalar === "string" && /^(?:true|yes|1)$/iu.test(scalar.trim()));
    case "number":
      return numberValue(scalar);
    case "date":
      return typeof scalar === "string" && DATE.test(scalar.trim()) ? scalar.trim() : null;
    case "link":
      return typeof scalar === "string" && isNoteLink(scalar.trim()) ? scalar.trim() : null;
    default:
      return scalar === null || scalar === undefined ? null : String(scalar);
  }
}

export function convertValue(value: PropertyValue, type: PropertyType): PropertyValue {
  if (type === "list") return asList(Array.isArray(value) || value === null || value === "" ? value : [value]);
  return convertScalar(Array.isArray(value) ? (value[0] ?? null) : value, type);
}

const BOOLEAN_TEXT = /^(?:true|false|yes|no|1|0)$/iu;

export type ConversionLoss = "items" | "value" | null;

export function conversionLoss(value: PropertyValue, type: PropertyType): ConversionLoss {
  if (type === "list" || value === null || value === "") return null;
  if (Array.isArray(value)) {
    if (value.length > 1) return "items";
    return value.length === 1 ? conversionLoss(value[0], type) : null;
  }
  if (convertValue(value, type) === null) return "value";
  if (type === "number" && typeof value !== "number" && !Number.isFinite(Number(String(value).trim()))) return "value";
  if (type === "checkbox" && typeof value !== "boolean" && !BOOLEAN_TEXT.test(String(value).trim())) return "value";
  return null;
}

function plainValue(key: string, value: unknown, type: PropertyType): PropertyValue {
  if (type === "list") return asList(value, key);
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  return JSON.stringify(value);
}

export function readProperties(frontMatter: string, known: Readonly<Record<string, PropertyType>> = {}): NoteProperty[] | null {
  const entries = frontMatterEntries(frontMatter);
  if (!entries) return null;
  return entries.flatMap(({ key, value, nested }) => {
    if (MANAGED_KEYS.has(key)) return [];
    const type = nested ? "text" : inferType(key, value, known[key]);
    return [{ key, type, value: nested ? JSON.stringify(value) : plainValue(key, value, type), readOnly: nested }];
  });
}

export function setProperty(frontMatter: string, key: string, value: PropertyValue): string {
  return MANAGED_KEYS.has(key) ? frontMatter : setEntry(frontMatter, key, value);
}

export function removeProperty(frontMatter: string, key: string): string {
  return MANAGED_KEYS.has(key) ? frontMatter : removeEntry(frontMatter, key);
}

export function mergeFrontMatter(base: string, mine: string, theirs: string): string {
  return mergeEntries(base, mine, theirs, IDENTITY_KEYS);
}

export function renameProperty(frontMatter: string, from: string, to: string): string {
  const name = to.trim();
  if (!name || name === from || MANAGED_KEYS.has(name) || MANAGED_KEYS.has(from)) return frontMatter;
  return renameEntry(frontMatter, from, name);
}

export function canAddProperty(frontMatter: string, key: string): boolean {
  const name = key.trim();
  if (!name || MANAGED_KEYS.has(name)) return false;
  const props = readProperties(frontMatter);
  return props !== null && !props.some((property) => property.key === name);
}

export function emptyValue(type: PropertyType): PropertyValue {
  if (type === "list") return [];
  if (type === "checkbox") return false;
  return null;
}
