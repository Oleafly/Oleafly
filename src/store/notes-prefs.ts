import { useMemo } from "react";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { readString, removeKey, writeString } from "@/lib/local-storage";
import { NOTES_HIGHLIGHT_COLORS, type NotesHighlightColor } from "@/lib/notes-appearance";
import { keepSame } from "@/lib/same-value";

export const NOTES_PREFS_KEY = "oleafly.notes.prefs";

export type HomeSort = "opened" | "edited" | "created" | "title";
export type HomeLayout = "grid" | "list" | "table";
export type PropertyType = "text" | "list" | "number" | "checkbox" | "date" | "link";
export type TaskState = "open" | "done" | "all";
export type TaskDue = "any" | "overdue" | "today" | "week" | "none";
export type TaskPriorityFilter = "any" | "high" | "medium" | "low" | "none";
export type TaskSort = "due" | "priority";

export interface TaskPrefs {
  state: TaskState;
  due: TaskDue;
  priority: TaskPriorityFilter;
  sort: TaskSort;
  tag: string | null;
  project: string | null;
}

export interface TableSort {
  key: string;
  descending: boolean;
}

export interface ModelChoice {
  providerId: string;
  modelId: string;
}

export const HOME_SORTS: readonly HomeSort[] = ["opened", "edited", "created", "title"];
export const HOME_LAYOUTS: readonly HomeLayout[] = ["grid", "list", "table"];
export const PROPERTY_TYPES: readonly PropertyType[] = ["text", "list", "number", "checkbox", "date", "link"];
export const TASK_STATES: readonly TaskState[] = ["open", "done", "all"];
export const TASK_DUES: readonly TaskDue[] = ["any", "overdue", "today", "week", "none"];
export const TASK_PRIORITIES: readonly TaskPriorityFilter[] = ["any", "high", "medium", "low", "none"];
export const TASK_SORTS: readonly TaskSort[] = ["due", "priority"];
export const DEFAULT_TASK_PREFS: TaskPrefs = { state: "open", due: "any", priority: "any", sort: "due", tag: null, project: null };
export const DEFAULT_TABLE_SORT: TableSort = { key: "edited", descending: true };
export const OPENED_LIMIT = 500;
export const COLUMN_LIMIT = 12;
export const MODEL_NOTES_LIMIT = 200;
export const GROUP_LIMIT = 500;

export interface NotesPrefs {
  homeSort: HomeSort;
  homeLayout: HomeLayout;
  tableColumns: readonly string[];
  tableSort: TableSort;
  opened: Readonly<Record<string, number>>;
  favorites: readonly string[];
  promptCollapsed: boolean;
  propertiesOpen: boolean;
  mentionsOpen: boolean;
  backlinksOpen: boolean;
  referencesOpen: boolean;
  deadLinksOpen: boolean;
  attachmentsOpen: boolean;
  filtersOpen: boolean;
  calendarOpen: boolean;
  tasks: TaskPrefs;
  closedGroups: readonly string[];
  highlightColor: NotesHighlightColor;
  propertyTypes: Readonly<Record<string, PropertyType>>;
  models: { last: ModelChoice | null; notes: Readonly<Record<string, ModelChoice>> };
}

interface NotesPrefsState extends NotesPrefs {
  set: <K extends keyof NotesPrefs>(key: K, value: NotesPrefs[K]) => void;
  recordOpened: (id: string, at?: number) => void;
  toggleFavorite: (id: string, favorite?: boolean) => void;
  rememberModel: (noteId: string, choice: ModelChoice) => void;
}

const DEFAULTS: NotesPrefs = {
  homeSort: "opened",
  homeLayout: "grid",
  tableColumns: [],
  tableSort: DEFAULT_TABLE_SORT,
  opened: {},
  favorites: [],
  promptCollapsed: false,
  propertiesOpen: true,
  mentionsOpen: true,
  backlinksOpen: true,
  referencesOpen: true,
  deadLinksOpen: true,
  attachmentsOpen: true,
  filtersOpen: false,
  calendarOpen: false,
  tasks: DEFAULT_TASK_PREFS,
  closedGroups: [],
  highlightColor: "yellow",
  propertyTypes: {},
  models: { last: null, notes: {} },
};

const safeStorage: StateStorage = {
  getItem: readString,
  setItem: (key, value) => {
    writeString(key, value);
  },
  removeItem: removeKey,
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function strings(value: unknown, limit: number): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim() !== ""))].slice(0, limit) : [];
}

function choiceOf(value: unknown): ModelChoice | null {
  const { providerId, modelId } = record(value);
  return typeof providerId === "string" && typeof modelId === "string" ? { providerId, modelId } : null;
}

function kept<T>(value: unknown, read: (item: unknown) => T | null, limit: number, order?: (left: T, right: T) => number): Record<string, T> {
  const entries = Object.entries(record(value)).flatMap(([key, item]): [string, T][] => {
    const parsed = read(item);
    return parsed === null ? [] : [[key, parsed]];
  });
  if (order) entries.sort((left, right) => order(left[1], right[1]));
  return Object.fromEntries(order ? entries.slice(0, limit) : entries.slice(-limit));
}

function oneOf<T extends string>(list: readonly T[], item: unknown, fallback: T): T {
  return list.find((candidate) => candidate === item) ?? fallback;
}

function taskPrefsOf(value: unknown): TaskPrefs {
  const prefs = record(value);
  const name = (item: unknown) => (typeof item === "string" && item.trim() !== "" ? item : null);
  return {
    state: oneOf(TASK_STATES, prefs.state, DEFAULT_TASK_PREFS.state),
    due: oneOf(TASK_DUES, prefs.due, DEFAULT_TASK_PREFS.due),
    priority: oneOf(TASK_PRIORITIES, prefs.priority, DEFAULT_TASK_PREFS.priority),
    sort: oneOf(TASK_SORTS, prefs.sort, DEFAULT_TASK_PREFS.sort),
    tag: name(prefs.tag),
    project: name(prefs.project),
  };
}

function normalized(value: unknown): NotesPrefs {
  const prefs = record(value);
  const sort = record(prefs.tableSort);
  const models = record(prefs.models);
  return {
    homeSort: oneOf(HOME_SORTS, prefs.homeSort, DEFAULTS.homeSort),
    homeLayout: oneOf(HOME_LAYOUTS, prefs.homeLayout, DEFAULTS.homeLayout),
    tableColumns: strings(prefs.tableColumns, COLUMN_LIMIT),
    tableSort: typeof sort.key === "string" && sort.key !== "" && typeof sort.descending === "boolean" ? { key: sort.key, descending: sort.descending } : DEFAULT_TABLE_SORT,
    opened: kept(prefs.opened, (item) => (typeof item === "number" && Number.isFinite(item) ? item : null), OPENED_LIMIT, (left, right) => right - left),
    favorites: strings(prefs.favorites, Number.POSITIVE_INFINITY),
    promptCollapsed: prefs.promptCollapsed === true,
    propertiesOpen: prefs.propertiesOpen !== false,
    mentionsOpen: prefs.mentionsOpen !== false,
    backlinksOpen: prefs.backlinksOpen !== false,
    referencesOpen: prefs.referencesOpen !== false,
    deadLinksOpen: prefs.deadLinksOpen !== false,
    attachmentsOpen: prefs.attachmentsOpen !== false,
    filtersOpen: prefs.filtersOpen === true,
    calendarOpen: prefs.calendarOpen === true,
    tasks: taskPrefsOf(prefs.tasks),
    closedGroups: strings(prefs.closedGroups, Number.POSITIVE_INFINITY).slice(-GROUP_LIMIT),
    highlightColor: oneOf(NOTES_HIGHLIGHT_COLORS, prefs.highlightColor, DEFAULTS.highlightColor),
    propertyTypes: kept(prefs.propertyTypes, (item) => PROPERTY_TYPES.find((type) => type === item) ?? null, Number.POSITIVE_INFINITY),
    models: { last: choiceOf(models.last), notes: kept(models.notes, choiceOf, MODEL_NOTES_LIMIT) },
  };
}

function prefsOf(state: NotesPrefsState): NotesPrefs {
  const { set: _set, recordOpened: _recordOpened, toggleFavorite: _toggleFavorite, rememberModel: _rememberModel, ...prefs } = state;
  return prefs;
}

export const useNotesPrefsStore = create<NotesPrefsState>()(
  persist(
    (setState, getState) => {
      const update = (patch: Partial<NotesPrefs>) => {
        const current = prefsOf(getState());
        const next = normalized({ ...current, ...patch });
        setState(Object.fromEntries(Object.entries(next).map(([key, value]) => [key, keepSame(current[key as keyof NotesPrefs], value)])));
      };
      return {
        ...DEFAULTS,
        set: (key, value) => update({ [key]: value }),
        recordOpened: (id, at = Date.now()) => update({ opened: { ...getState().opened, [id]: at } }),
        toggleFavorite: (id, favorite) => {
          const current = getState().favorites;
          if (current.includes(id) === (favorite ?? !current.includes(id))) return;
          update({ favorites: current.includes(id) ? current.filter((candidate) => candidate !== id) : [id, ...current] });
        },
        rememberModel: (noteId, choice) => {
          const { [noteId]: _old, ...notes } = getState().models.notes;
          const latest = { providerId: choice.providerId, modelId: choice.modelId };
          update({ models: { last: latest, notes: { ...notes, [noteId]: latest } } });
        },
      };
    },
    {
      name: NOTES_PREFS_KEY,
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: prefsOf,
      merge: (persisted, current) => ({ ...current, ...normalized(persisted) }),
    },
  ),
);

export function useNoteFavorites(): ReadonlySet<string> {
  const ids = useNotesPrefsStore((state) => state.favorites);
  return useMemo(() => new Set(ids), [ids]);
}
