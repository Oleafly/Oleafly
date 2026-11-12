import { compareText } from "@/lib/intl";
import type { HomeSort } from "@/store/notes-prefs";
import type { NoteItem } from "./types";

export type HomeTab = "mine" | "favorites" | "tasks" | "attachments";

export const HOME_TABS: readonly HomeTab[] = ["mine", "favorites", "tasks", "attachments"];

export interface HomeQuery {
  tab: HomeTab;
  favorites: ReadonlySet<string>;
  sort: HomeSort;
  opened: Readonly<Record<string, number>>;
  test?: (note: NoteItem) => boolean;
  matches?: ReadonlySet<string> | null;
}

export function openedAt(note: NoteItem, opened: Readonly<Record<string, number>>): number {
  return opened[note.id] ?? note.updatedAt;
}

export function createdAt(note: NoteItem): number {
  return note.createdAt ?? note.updatedAt;
}

function byId(left: NoteItem, right: NoteItem): number {
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

function compare(sort: HomeSort, opened: Readonly<Record<string, number>>): (left: NoteItem, right: NoteItem) => number {
  if (sort === "title") return (left, right) => compareText(left.title, right.title) || byId(left, right);
  const time = (note: NoteItem) => {
    if (sort === "opened") return openedAt(note, opened);
    if (sort === "created") return createdAt(note);
    return note.updatedAt;
  };
  return (left, right) => time(right) - time(left) || byId(left, right);
}

export function homeNotes(notes: readonly NoteItem[], query: HomeQuery): NoteItem[] {
  const matched = (note: NoteItem) => (query.matches ? query.matches.has(note.id) : (query.test?.(note) ?? true));
  return notes
    .filter((note) => (query.tab === "mine" || query.favorites.has(note.id)) && matched(note))
    .sort(compare(query.sort, query.opened));
}
