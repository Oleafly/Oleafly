import type { Editor } from "@tiptap/core";
import { Pilcrow } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { isSelectionModifier } from "@/store/library-selection";
import { useNotesPrefsStore } from "@/store/notes-prefs";
import { shortText } from "./note-block-ids";
import { findDocBlock, revealBlock } from "./note-block-links";
import { NoteChip } from "./note-icons";
import type { OpenNoteHandler } from "./note-links";
import { NoteLinkSection, NoteListItem, useNotePanelSections } from "./NoteListItem";
import { NoteMentions } from "./NoteMentions";
import { type Backlink, useNoteBacklinks, useNoteLinkRecords } from "./use-note-links";
import { NoteSnippet } from "./NoteSnippet";

const BACKLINK_LIMIT = 50;

function BlockTarget({ editor, backlink }: Readonly<{ editor: Editor; backlink: Backlink }>) {
  const { t } = useTranslation(["notes"]);
  const block = backlink.blocks?.map((entry) => findDocBlock(editor.state.doc, entry.block)).find(Boolean);
  if (!block?.id) return null;
  const label = t(($) => $.notes.linksSearch.blocks.toBlock, { text: shortText(block.text) || `^${block.id}` });
  const id = block.id;
  return (
    <TooltipIconButton label={label} className="mt-1 size-7 shrink-0 text-muted-foreground" onClick={() => revealBlock(editor.view, id)}>
      <Pilcrow aria-hidden className="size-3.5" />
    </TooltipIconButton>
  );
}

export function NoteBacklinks({
  noteId,
  onOpenNote,
  editor,
  className,
}: Readonly<{ noteId: string | null | undefined; onOpenNote: OpenNoteHandler; editor?: Editor; className?: string }>) {
  const { t } = useTranslation(["notes"]);
  const [all, setAll] = useState(false);
  const backlinks = useNoteBacklinks(noteId);
  const open = useNotesPrefsStore((state) => state.backlinksOpen);
  const panel = useNotePanelSections();
  const loading = useNoteLinkRecords(panel).data === null && panel;
  const mentions = <NoteMentions noteId={noteId} onOpenNote={onOpenNote} className={className} />;
  if (backlinks.length === 0 && !panel) return mentions;
  const shown = all ? backlinks : backlinks.slice(0, BACKLINK_LIMIT);
  return (
    <>
      <NoteLinkSection
        data-note-backlinks=""
        title={t(($) => $.notes.links.linkedFrom)}
        open={open}
        count={loading ? undefined : backlinks.length}
        empty={t(($) => $.notes.info.noBacklinks)}
        onOpenChange={(next) => useNotesPrefsStore.getState().set("backlinksOpen", next)}
        className={className}
        footer={
          shown.length < backlinks.length ? (
            <Button variant="ghost" size="xs" className="mt-1" onClick={() => setAll(true)}>
              {t(($) => $.notes.links.showAll, { total: backlinks.length })}
            </Button>
          ) : null
        }
      >
        {shown.map((backlink) => (
          <li key={backlink.projectId}>
            <NoteListItem
              icon={<NoteChip icon={backlink.icon} color={backlink.color} />}
              title={backlink.title}
              snippet={backlink.snippet ? <NoteSnippet text={backlink.snippet} /> : undefined}
              trailing={editor && backlink.blocks ? <BlockTarget editor={editor} backlink={backlink} /> : undefined}
              onClick={(event) => onOpenNote(backlink.noteId, { newTab: isSelectionModifier(event), projectId: backlink.projectId })}
            />
          </li>
        ))}
      </NoteLinkSection>
      {mentions}
    </>
  );
}
