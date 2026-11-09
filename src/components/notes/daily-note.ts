import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { notifyError } from "@/lib/toast";
import { draftFromTemplate, localDate, TEMPLATES_BY_ID } from "./note-templates";
import { type NotesData, useNotesData } from "./notes-data";
import type { NoteItem } from "./types";

export const DAILY_TAG = "daily";

const pending = new Map<string, Promise<string>>();

function isDaily(note: NoteItem): boolean {
  return (note.tags ?? []).some((tag) => tag.toLowerCase() === DAILY_TAG);
}

export function findDailyNote(notes: readonly NoteItem[], now: Date): NoteItem | undefined {
  const title = localDate(now);
  const matches = notes.filter((note) => note.title === title);
  return matches.find(isDaily) ?? matches[0];
}

export async function dailyNoteId(
  data: Pick<NotesData, "notes" | "createNoteFrom">,
  now: Date,
  locale: string,
): Promise<string | null> {
  const existing = findDailyNote(data.notes, now);
  if (existing) return existing.id;
  const create = data.createNoteFrom;
  if (!create) return null;
  const title = localDate(now);
  let creating = pending.get(title);
  if (!creating) {
    creating = create(draftFromTemplate(TEMPLATES_BY_ID.daily, title, now, locale)).finally(() => pending.delete(title));
    pending.set(title, creating);
  }
  return creating;
}

export function useOpenDailyNote(onOpen: (id: string) => void): (() => void) | undefined {
  const { t, i18n } = useTranslation(["notes"]);
  const data = useNotesData();
  const { notes, createNoteFrom } = data;
  const open = useCallback(() => {
    dailyNoteId({ notes, createNoteFrom }, new Date(), i18n.language).then(
      (id) => {
        if (id) onOpen(id);
      },
      (error: unknown) => notifyError("open the daily note", error, t(($) => $.notes.vault.daily.failed)),
    );
  }, [createNoteFrom, i18n.language, notes, onOpen, t]);
  const available = createNoteFrom !== undefined || findDailyNote(notes, new Date()) !== undefined;
  return available ? open : undefined;
}
