import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { frontMatterEntries, readList } from "@/lib/front-matter-yaml";
import {
  BUILT_IN_TEMPLATE,
  NOTE_TEMPLATE,
  NOTES_PERIODIC_DEFAULTS,
  type NotesPeriodic,
  type PeriodicKind,
  parseDayTitle,
  periodStart,
  periodTitle,
  resolveWeekStart,
  type WeekDay,
} from "@/lib/notes-periodic";
import { notifyError } from "@/lib/toast";
import { useSettingsStore } from "@/store/settings";
import { removeProperty } from "./note-properties";
import { draftFromNote, draftFromTemplate, type TemplateId, TEMPLATES_BY_ID } from "./note-templates";
import { tagKey } from "./note-tags";
import { type NoteDraft, type NotesData, useNotesData } from "./notes-data";
import type { NoteItem } from "./types";

const pending = new Map<string, Promise<string>>();

function hasTag(note: NoteItem, tag: string): boolean {
  const wanted = tagKey(tag);
  return (note.tags ?? []).some((candidate) => tagKey(candidate) === wanted);
}

function isPeriodic(note: NoteItem, tag: string): boolean {
  return tag === "" || hasTag(note, tag);
}

export interface DailyNeighbors {
  previous?: NoteItem;
  next?: NoteItem;
}

export function dailyNeighbors(notes: readonly NoteItem[], noteId: string, settings: NotesPeriodic = NOTES_PERIODIC_DEFAULTS, locale = "en"): DailyNeighbors | null {
  const { format, tag } = settings.daily;
  const first = resolveWeekStart(settings.weekStart, locale);
  const dateOf = (note: NoteItem) => (isPeriodic(note, tag) ? parseDayTitle(format, note.title, locale, first) : null);
  const note = notes.find((candidate) => candidate.id === noteId);
  const at = note ? dateOf(note) : null;
  if (!at) return null;
  const found: { previous?: [NoteItem, Date]; next?: [NoteItem, Date] } = {};
  for (const day of notes) {
    if (day.id === noteId) continue;
    const date = dateOf(day);
    if (!date) continue;
    if (date < at && (!found.previous || date > found.previous[1])) found.previous = [day, date];
    if (date > at && (!found.next || date < found.next[1])) found.next = [day, date];
  }
  if (!found.previous && !found.next) return null;
  return { previous: found.previous?.[0], next: found.next?.[0] };
}

function usePeriodicSettings(): NotesPeriodic {
  return useSettingsStore((state) => state.notesPeriodic);
}

export function useNotesWeekStart(): WeekDay {
  const setting = useSettingsStore((state) => state.notesPeriodic.weekStart);
  const { i18n } = useTranslation();
  return resolveWeekStart(setting, i18n.language);
}

export function useDailyNeighbors(noteId: string): DailyNeighbors | null {
  const { notes } = useNotesData();
  const settings = usePeriodicSettings();
  const { i18n } = useTranslation();
  return useMemo(() => dailyNeighbors(notes, noteId, settings, i18n.language), [i18n.language, noteId, notes, settings]);
}

export function titledNotes(notes: readonly NoteItem[]): ReadonlyMap<string, readonly NoteItem[]> {
  const byTitle = new Map<string, NoteItem[]>();
  for (const note of notes) byTitle.set(note.title, [...(byTitle.get(note.title) ?? []), note]);
  return byTitle;
}

export function pickPeriodic(matches: readonly NoteItem[] | undefined, tag: string): NoteItem | undefined {
  if (!matches) return undefined;
  return (tag ? matches.find((note) => hasTag(note, tag)) : undefined) ?? matches[0];
}

function findPeriodicNote(notes: readonly NoteItem[], kind: PeriodicKind, date: Date, settings: NotesPeriodic, locale: string): NoteItem | undefined {
  const title = periodTitle(kind, settings, date, locale);
  return pickPeriodic(
    notes.filter((note) => note.title === title),
    settings[kind].tag,
  );
}

export function findDailyNote(notes: readonly NoteItem[], now: Date, settings: NotesPeriodic = NOTES_PERIODIC_DEFAULTS, locale = "en"): NoteItem | undefined {
  return findPeriodicNote(notes, "daily", now, settings, locale);
}

function withTag(draft: NoteDraft, tag: string): NoteDraft {
  if (!tag) return draft;
  const block = `---\n${draft.properties ?? ""}\n---`;
  const tags = readList(frontMatterEntries(block)?.find((entry) => entry.key === "tags")?.value, /[,\s]+/u);
  if (tags.some((existing) => tagKey(existing) === tagKey(tag))) return draft;
  return { ...draft, properties: removeProperty(block, "tags").slice(4, -4), tags: [tag, ...tags] };
}

type PeriodicData = Pick<NotesData, "notes" | "createNoteFrom"> & Partial<Pick<NotesData, "loadNote">>;

function periodicDraft(data: PeriodicData, kind: PeriodicKind, date: Date, settings: NotesPeriodic, locale: string): NoteDraft | Promise<NoteDraft> {
  const title = periodTitle(kind, settings, date, locale);
  const start = kind === "daily" ? date : periodStart(kind, date, resolveWeekStart(settings.weekStart, locale));
  const { template, tag } = settings[kind];
  if (template.startsWith(NOTE_TEMPLATE) && data.loadNote) {
    return data.loadNote(template.slice(NOTE_TEMPLATE.length)).then((source) => withTag({ ...draftFromNote(title, source.text, start, locale), title }, tag));
  }
  const builtIn = template.startsWith(BUILT_IN_TEMPLATE) ? TEMPLATES_BY_ID[template.slice(BUILT_IN_TEMPLATE.length) as TemplateId] : undefined;
  return withTag(builtIn ? { ...draftFromTemplate(builtIn, title, start, locale), title } : { title, body: "" }, tag);
}

export async function periodicNoteId(
  data: PeriodicData,
  kind: PeriodicKind,
  date: Date,
  settings: NotesPeriodic,
  locale: string,
): Promise<string | null> {
  const existing = findPeriodicNote(data.notes, kind, date, settings, locale);
  if (existing) return existing.id;
  const create = data.createNoteFrom;
  if (!create || !settings[kind].enabled) return null;
  const key = `${kind}:${periodTitle(kind, settings, date, locale)}`;
  let creating = pending.get(key);
  if (!creating) {
    const draft = periodicDraft(data, kind, date, settings, locale);
    creating = (draft instanceof Promise ? draft.then(create) : create(draft)).finally(() => pending.delete(key));
    pending.set(key, creating);
  }
  return creating;
}

export function dailyNoteId(data: PeriodicData, now: Date, locale: string, settings: NotesPeriodic = NOTES_PERIODIC_DEFAULTS): Promise<string | null> {
  return periodicNoteId(data, "daily", now, settings, locale);
}

export type OpenPeriodicNote = (kind: PeriodicKind, date: Date) => void;

export function useOpenPeriodicNote(onOpen: (id: string) => void): OpenPeriodicNote {
  const { t, i18n } = useTranslation(["notes"]);
  const { notes, createNoteFrom, loadNote } = useNotesData();
  const settings = usePeriodicSettings();
  return useCallback(
    (kind, date) => {
      periodicNoteId({ notes, createNoteFrom, loadNote }, kind, date, settings, i18n.language).then(
        (id) => {
          if (id) onOpen(id);
        },
        (error: unknown) => notifyError(`open the ${kind} note`, error, kind === "daily" ? t(($) => $.notes.vault.daily.failed) : t(($) => $.notes.calendar.failed[kind])),
      );
    },
    [createNoteFrom, i18n.language, loadNote, notes, onOpen, settings, t],
  );
}

export function useOpenDailyNote(onOpen: (id: string) => void): (() => void) | undefined {
  const { i18n } = useTranslation();
  const { notes, createNoteFrom } = useNotesData();
  const settings = usePeriodicSettings();
  const openPeriodic = useOpenPeriodicNote(onOpen);
  const open = useCallback(() => openPeriodic("daily", new Date()), [openPeriodic]);
  const available = (createNoteFrom !== undefined && settings.daily.enabled) || findDailyNote(notes, new Date(), settings, i18n.language) !== undefined;
  return available ? open : undefined;
}
