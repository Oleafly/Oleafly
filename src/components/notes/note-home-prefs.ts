import { useEffect } from "react";
import { parseJson, storedValue, useStoredValue } from "./note-storage";

export type HomeSort = "opened" | "edited" | "created" | "title";
export type HomeLayout = "grid" | "list" | "table";

export interface TableSort {
  key: string;
  descending: boolean;
}

export const HOME_SORTS: readonly HomeSort[] = ["opened", "edited", "created", "title"];
export const NOTE_HOME_SORT_KEY = "oleafly.notes.home.sort";
export const NOTE_HOME_LAYOUT_KEY = "oleafly.notes.home.layout";
export const NOTE_OPENED_KEY = "oleafly.notes.opened";
export const OPENED_LIMIT = 500;
export const NOTE_HOME_COLUMNS_KEY = "oleafly.notes.home.columns";
export const NOTE_HOME_TABLE_SORT_KEY = "oleafly.notes.home.tableSort";
export const COLUMN_LIMIT = 12;
export const DEFAULT_TABLE_SORT: TableSort = { key: "edited", descending: true };

const sort = storedValue<HomeSort>(
  NOTE_HOME_SORT_KEY,
  (raw) => HOME_SORTS.find((value) => value === raw) ?? "opened",
  (value) => value,
);

const layout = storedValue<HomeLayout>(
  NOTE_HOME_LAYOUT_KEY,
  (raw) => (raw === "list" || raw === "table" ? raw : "grid"),
  (value) => value,
);

const opened = storedValue<Readonly<Record<string, number>>>(
  NOTE_OPENED_KEY,
  (raw) => {
    const value = parseJson(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1])),
    );
  },
  (value) => JSON.stringify(value),
);

const columns = storedValue<readonly string[]>(
  NOTE_HOME_COLUMNS_KEY,
  (raw) => {
    const value = parseJson(raw);
    if (!Array.isArray(value)) return [];
    const keys = value.filter((key): key is string => typeof key === "string" && key.trim() !== "");
    return [...new Set(keys)].slice(0, COLUMN_LIMIT);
  },
  (value) => JSON.stringify(value),
);

const tableSort = storedValue<TableSort>(
  NOTE_HOME_TABLE_SORT_KEY,
  (raw) => {
    const value = parseJson(raw);
    if (typeof value !== "object" || value === null) return DEFAULT_TABLE_SORT;
    const { key, descending } = value as Record<string, unknown>;
    return typeof key === "string" && key !== "" && typeof descending === "boolean" ? { key, descending } : DEFAULT_TABLE_SORT;
  },
  (value) => JSON.stringify(value),
);

export function useTableColumns(): readonly string[] {
  return useStoredValue(columns);
}

export function saveTableColumns(value: readonly string[]): void {
  columns.write([...new Set(value)].slice(0, COLUMN_LIMIT));
}

export function useTableSort(): TableSort {
  return useStoredValue(tableSort);
}

export function saveTableSort(value: TableSort): void {
  tableSort.write(value);
}

export function useHomeSort(): HomeSort {
  return useStoredValue(sort);
}

export function saveHomeSort(value: HomeSort): void {
  sort.write(value);
}

export function useHomeLayout(): HomeLayout {
  return useStoredValue(layout);
}

export function saveHomeLayout(value: HomeLayout): void {
  layout.write(value);
}

export function useNoteOpenedTimes(): Readonly<Record<string, number>> {
  return useStoredValue(opened);
}

export function recordNoteOpened(id: string, at = Date.now()): void {
  const kept = Object.entries(opened.read())
    .filter(([candidate]) => candidate !== id)
    .sort((left, right) => right[1] - left[1])
    .slice(0, OPENED_LIMIT - 1);
  opened.write(Object.fromEntries([[id, at], ...kept]));
}

export function useRecordNoteOpened(id: string | null): void {
  useEffect(() => {
    if (id) recordNoteOpened(id);
  }, [id]);
}
