import { useId } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { isSelectionModifier } from "@/store/library-selection";
import { NoteChip } from "./note-icons";
import type { OpenNoteHandler } from "./note-links";
import { NoteMentions } from "./NoteMentions";
import { useNoteBacklinks } from "./use-note-links";

export function NoteBacklinks({
  noteId,
  onOpenNote,
  className,
}: Readonly<{ noteId: string | null | undefined; onOpenNote: OpenNoteHandler; className?: string }>) {
  const { t } = useTranslation(["notes"]);
  const headingId = useId();
  const backlinks = useNoteBacklinks(noteId);
  const mentions = <NoteMentions noteId={noteId} onOpenNote={onOpenNote} className={backlinks.length === 0 ? className : "mt-6"} />;
  if (backlinks.length === 0) return mentions;
  return (
    <>
      <section aria-labelledby={headingId} data-note-backlinks className={cn("mt-12 border-t pt-4", className)}>
        <h2 id={headingId} className="px-2 text-xs font-medium text-muted-foreground">
          {t(($) => $.notes.links.linkedFrom)}
        </h2>
        <ul className="mt-2 space-y-0.5">
          {backlinks.map((backlink) => (
            <li key={backlink.projectId}>
              <button
                type="button"
                onClick={(event) =>
                  onOpenNote(backlink.noteId, { newTab: isSelectionModifier(event), projectId: backlink.projectId })
                }
                className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent motion-reduce:transition-none"
              >
                <NoteChip icon={backlink.icon} color={backlink.color} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{backlink.title}</span>
                  {backlink.snippet && (
                    <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{backlink.snippet}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {mentions}
    </>
  );
}
