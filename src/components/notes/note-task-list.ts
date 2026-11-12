import { normalizeText } from "@oleafly/search-query";
import { compareText } from "@/lib/intl";
import type { NoteTaskRecord } from "@/lib/tauri";
import type { TaskDue, TaskPrefs, TaskPriorityFilter } from "@/store/notes-prefs";
import { addDays, startOfDay } from "@/lib/notes-periodic";
import { openNoteEditor } from "@/lib/open-note-editors";
import { DUE_KEY, fieldKey, fieldValue, inlineFields, isoDate, PRIORITY_KEY, priorityOf, SCHEDULED_KEY, type FieldAttrs, type Priority } from "./note-field-values";
import { stripBlockIdMarkers } from "./note-block-ids";
import { noteItemLines } from "./note-block-links";
import { plainHeading } from "./note-link-format";
import { plainTextTags, tagKey } from "./note-tags";
import type { NotesData } from "./notes-data";
import type { NoteItem } from "./types";

interface TaskFilters extends TaskPrefs {
  search: string;
}

export interface TaskEntry {
  key: string;
  noteId: string;
  noteTitle: string;
  line: number;
  checked: boolean;
  raw: string;
  text: string;
  fields: readonly FieldAttrs[];
  due: string | null;
  scheduled: string | null;
  priority: Priority | null;
  tags: readonly string[];
  ownTags: readonly string[];
  projectId: string | null;
  projectName: string | null;
}

const PRIORITY_RANK: Readonly<Record<Priority, number>> = { highest: 0, high: 1, medium: 2, low: 3, lowest: 4 };
const NO_PRIORITY = 5;
const WEEK_DAYS = 7;

function fieldOf(fields: readonly FieldAttrs[], key: string): string | null {
  const found = fields.find((field) => fieldKey(field.key) === key);
  return found ? fieldValue(found.value) : null;
}

function dateOf(fields: readonly FieldAttrs[], key: string): string | null {
  const value = fieldOf(fields, key);
  return value && isoDate(value) ? value : null;
}

function without(text: string, ranges: readonly { from: number; to: number }[]): string {
  return [...ranges].sort((left, right) => right.from - left.from).reduce((rest, range) => rest.slice(0, range.from) + rest.slice(range.to), text);
}

export function taskText(raw: string): string {
  const bare = stripBlockIdMarkers(raw);
  const plain = plainHeading(without(bare, inlineFields(bare)));
  return without(plain, plainTextTags(plain)).replaceAll(/\s+/gu, " ").trim();
}

export function taskEntries(records: readonly NoteTaskRecord[], notes: readonly NoteItem[]): TaskEntry[] {
  const byId = new Map(notes.map((note) => [note.id, note]));
  return records.flatMap((record) => {
    const note = byId.get(record.projectId);
    if (!note) return [];
    const noteTags = (note.tags ?? []).map(tagKey);
    return record.tasks.map((task): TaskEntry => {
      const fields = inlineFields(task.text).map(({ key, value }) => ({ key, value }));
      const own = plainTextTags(task.text).map((range) => tagKey(range.tag));
      return {
        key: `${note.id}:${task.line}`,
        noteId: note.id,
        noteTitle: note.title,
        line: task.line,
        checked: task.checked,
        raw: task.text,
        text: taskText(task.text),
        fields,
        due: dateOf(fields, DUE_KEY),
        scheduled: dateOf(fields, SCHEDULED_KEY),
        priority: priorityOf(fieldOf(fields, PRIORITY_KEY) ?? ""),
        tags: [...new Set([...own, ...noteTags])],
        ownTags: [...new Set(own)],
        projectId: note.relatedProjectId ?? null,
        projectName: note.relatedProjectId ? note.project : null,
      };
    });
  });
}

function dueMatches(entry: TaskEntry, due: TaskDue, today: Date): boolean {
  if (due === "any") return true;
  const date = entry.due ? isoDate(entry.due) : null;
  if (due === "none") return date === null;
  if (!date) return false;
  if (due === "overdue") return date < today;
  if (due === "today") return date.getTime() === today.getTime();
  return date >= today && date < addDays(today, WEEK_DAYS);
}

function priorityMatches(entry: TaskEntry, priority: TaskPriorityFilter): boolean {
  if (priority === "any") return true;
  if (priority === "none") return entry.priority === null;
  if (priority === "high") return entry.priority === "high" || entry.priority === "highest";
  if (priority === "low") return entry.priority === "low" || entry.priority === "lowest";
  return entry.priority === priority;
}

function tagMatches(entry: TaskEntry, tag: string | null): boolean {
  if (!tag) return true;
  const wanted = tagKey(tag);
  return entry.tags.some((candidate) => candidate === wanted || candidate.startsWith(`${wanted}/`));
}

function searchMatches(entry: TaskEntry, search: string): boolean {
  const words = normalizeText(search).split(/\s+/u).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalizeText(`${entry.text} ${entry.noteTitle}`);
  return words.every((word) => haystack.includes(word));
}

function byDue(left: TaskEntry, right: TaskEntry): number {
  if (left.due === right.due) return 0;
  if (left.due === null) return 1;
  if (right.due === null) return -1;
  return left.due < right.due ? -1 : 1;
}

function byPriority(left: TaskEntry, right: TaskEntry): number {
  const rank = (entry: TaskEntry) => (entry.priority ? PRIORITY_RANK[entry.priority] : NO_PRIORITY);
  return rank(left) - rank(right);
}

function byPlace(left: TaskEntry, right: TaskEntry): number {
  return compareText(left.noteTitle, right.noteTitle) || left.line - right.line;
}

export function filterTasks(entries: readonly TaskEntry[], filters: TaskFilters, now: Date): TaskEntry[] {
  const today = startOfDay(now);
  const shown = entries.filter(
    (entry) =>
      (filters.state === "all" || entry.checked === (filters.state === "done")) &&
      dueMatches(entry, filters.due, today) &&
      priorityMatches(entry, filters.priority) &&
      tagMatches(entry, filters.tag) &&
      (filters.project === null || entry.projectId === filters.project) &&
      searchMatches(entry, filters.search),
  );
  const [first, second] = filters.sort === "due" ? [byDue, byPriority] : [byPriority, byDue];
  return shown.sort((left, right) => first(left, right) || second(left, right) || byPlace(left, right));
}

const ITEM_TYPES = new Set(["listItem", "taskItem"]);
const TASK_LINE = /^(\s*(?:>\s*)*[-*+][ \t]+\[)([ xX])(\](?:[ \t]|$))/u;

export function toggledTaskLine(text: string, line: number, raw: string, checked: boolean): string | null {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/u);
  const current = lines[line];
  const match = current === undefined ? null : TASK_LINE.exec(current);
  if (!match || (match[2] !== " ") !== checked || stripBlockIdMarkers(current.slice(match[0].length)).trim() !== stripBlockIdMarkers(raw).trim()) return null;
  lines[line] = `${match[1]}${checked ? " " : "x"}${current.slice(match[1].length + 1)}`;
  return lines.join(newline);
}

function toggleInEditor(entry: TaskEntry): boolean | null {
  const open = openNoteEditor(entry.noteId);
  if (!open || open.editor.isDestroyed) return null;
  const { editor } = open;
  if (!editor.isEditable) return false;
  const text = open.text();
  if (toggledTaskLine(text, entry.line, entry.raw, entry.checked) === null) return false;
  const lines = noteItemLines(text);
  const items: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (ITEM_TYPES.has(node.type.name)) items.push(pos);
    return true;
  });
  const target = items.length === lines.length ? items[lines.indexOf(entry.line)] : undefined;
  const node = target === undefined ? null : editor.state.doc.nodeAt(target);
  if (target === undefined || node?.attrs.task !== true || node.attrs.checked !== entry.checked) return false;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(target, undefined, { ...node.attrs, checked: !entry.checked }));
  return true;
}

export async function toggleTask(data: Pick<NotesData, "loadNote" | "saveNote">, entry: TaskEntry): Promise<boolean> {
  const inEditor = toggleInEditor(entry);
  if (inEditor !== null) return inEditor;
  const source = await data.loadNote(entry.noteId);
  const next = toggledTaskLine(source.text, entry.line, entry.raw, entry.checked);
  if (next === null) return false;
  await data.saveNote(entry.noteId, next, source.version);
  return true;
}
