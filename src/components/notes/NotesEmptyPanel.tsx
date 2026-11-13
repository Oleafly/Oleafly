import { House, Plus, Search } from "lucide-react";
import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { RingsPattern } from "@/components/ui/rings-pattern";
import { SectionHeading } from "@/components/ui/section-heading";
import { shortcutLabel, useShortcutStore } from "@/store/shortcuts";
import { homeNotes } from "./home-notes";
import { NoteChip } from "./note-icons";
import { useNotesData } from "./notes-data";
import { NotesStart, QUIET_BUTTON } from "./NotesStart";

const RECENT_LIMIT = 4;
const NO_IDS: ReadonlySet<string> = new Set();
const NO_OPENED: Readonly<Record<string, number>> = {};

interface NotesEmptyPanelProps {
  onHome: () => void;
  onNewNote?: () => void;
  onOpenNote: (id: string) => void;
  onSearch: () => void;
}

export function NotesEmptyPanel({ onHome, onNewNote, onOpenNote, onSearch }: Readonly<NotesEmptyPanelProps>) {
  const { t } = useTranslation(["notes"]);
  const { notes } = useNotesData();
  const hasNotes = notes.length > 0;
  const continueId = useId();
  const searchKeys = useShortcutStore((state) => shortcutLabel(state.bindings.notesSearch));
  const recent = useMemo(
    () => homeNotes(notes, { tab: "mine", favorites: NO_IDS, sort: "edited", opened: NO_OPENED }).slice(0, RECENT_LIMIT),
    [notes],
  );
  const newNoteLabel = t(($) => $.notes.library.newNote);

  return (
    <div data-empty-panel className="@container relative flex h-full min-h-0 flex-col overflow-y-auto bg-background px-3 @min-[24rem]:px-6">
      <RingsPattern />
      <div className="relative flex shrink-0 flex-wrap justify-end gap-2 pt-5">
        <Button variant="outline" size="sm" onClick={onHome}>
          <House aria-hidden />
          <span className="@max-[16rem]:sr-only">{t(($) => $.notes.workspace.home)}</span>
        </Button>
        {onNewNote && (
          <Button size="sm" onClick={onNewNote}>
            <Plus aria-hidden />
            <span className="@max-[16rem]:sr-only">{newNoteLabel}</span>
          </Button>
        )}
      </div>
      <div className="@container relative mx-auto flex w-full max-w-[40rem] flex-col gap-6 pb-10 pt-7">
        <NotesStart hasNotes={hasNotes} onNewNote={onNewNote} onOpenNote={onOpenNote} />
        {hasNotes && (
          <section aria-labelledby={continueId} className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <SectionHeading id={continueId}>{t(($) => $.notes.workspace.empty.continue)}</SectionHeading>
              <Button variant="ghost" size="sm" className={QUIET_BUTTON} onClick={onSearch}>
                <Search aria-hidden />
                <span className="@max-[20rem]:sr-only">{t(($) => $.notes.workspace.empty.searchAll)}</span>
                <Kbd aria-hidden>{searchKeys}</Kbd>
              </Button>
            </div>
            <div data-recent-notes className="flex flex-wrap justify-center gap-2">
              {recent.map((note) => (
                <Button
                  key={note.id}
                  variant="outline"
                  size="sm"
                  className="max-w-[min(100%,18.75rem)] rounded-full bg-card pl-2 font-normal [&_svg]:size-3"
                  onClick={() => onOpenNote(note.id)}
                >
                  <NoteChip icon={note.icon} color={note.color} size="xs" className="rounded-full" />
                  <span className="truncate">{note.title}</span>
                </Button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
