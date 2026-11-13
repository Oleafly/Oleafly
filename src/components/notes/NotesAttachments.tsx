import { FolderOpen, Link2, Paperclip, SearchX } from "lucide-react";
import { memo, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileIcon } from "@/components/files/fileIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyMedia, EmptyState, ErrorState, LoadingState } from "@/components/ui/empty";
import { Tooltip } from "@/components/ui/tooltip";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { ROW_WINDOW_ITEM, useRowWindow } from "@/hooks/use-row-window";
import { writeClipboardText } from "@/lib/clipboard";
import { fileLinkSource } from "@/lib/file-links";
import { formatBytes } from "@/lib/format-bytes";
import { logError } from "@/lib/log";
import { NOTE_FILE } from "@/lib/project-notes";
import { notifyError, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useNotesPrefsStore } from "@/store/notes-prefs";
import { noteAssetActions } from "./block-views";
import {
  ATTACHMENT_TYPES,
  ATTACHMENT_USES,
  type AttachmentRows,
  type AttachmentTypeFilter,
  type AttachmentUse,
  filterAttachments,
  type NoteAttachment,
  noteAttachments,
  revealAttachment,
  vaultAttachmentSources,
} from "./note-attachments";
import { NoteChip } from "./note-icons";
import { NoteLinkSection } from "./NoteListItem";
import { FilterMenu } from "./NotesTasks";
import { useNotesData, useVaultLoad } from "./notes-data";
import type { NoteItem } from "./types";

const UNMEASURED_ROWS = 24;

type ResolveAsset = (noteId: string, path: string) => Promise<string | null>;

interface NotesAttachmentsProps {
  search: string;
  scrollRef: RefObject<HTMLElement | null>;
  iconFor: (note: NoteItem) => string | undefined;
  onOpenNote: (id: string) => void;
}

interface RowActions {
  open: (item: NoteAttachment) => void;
  reveal: (item: NoteAttachment) => void;
  copy: (item: NoteAttachment) => void;
}

function AttachmentThumb({ item, resolve }: Readonly<{ item: NoteAttachment; resolve?: ResolveAsset }>) {
  const [shown, setShown] = useState<{ key: string; url: string | null } | null>(null);
  const { key, noteId, path, type } = item;
  useEffect(() => {
    if (type !== "image" || !resolve) return;
    let live = true;
    resolve(noteId, path).then(
      (url) => {
        if (live) setShown({ key, url });
      },
      () => {
        if (live) setShown({ key, url: null });
      },
    );
    return () => {
      live = false;
    };
  }, [key, noteId, path, resolve, type]);
  const url = shown?.key === key ? shown.url : null;
  return (
    <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
      {url ? <img src={url} alt="" draggable={false} className="size-full object-cover" /> : <FileIcon name={item.name} className="size-4" />}
    </span>
  );
}

const AttachmentRow = memo(function AttachmentRow({
  item,
  note,
  icon,
  resolve,
  actions,
  inNote = false,
}: Readonly<{
  item: NoteAttachment;
  note: NoteItem | undefined;
  icon: string | undefined;
  resolve?: ResolveAsset;
  actions: RowActions;
  inNote?: boolean;
}>) {
  const { t } = useTranslation(["notes", "core"]);
  const title = note?.title ?? "";
  const name = inNote ? (
    <button
      type="button"
      className="min-w-0 truncate rounded-sm text-left text-sm transition-colors hover:text-primary focus-visible:bg-accent motion-reduce:transition-none"
      onClick={() => actions.open(item)}
    >
      {item.name}
    </button>
  ) : (
    <span className="min-w-0 truncate text-sm">{item.name}</span>
  );
  return (
    <li
      {...{ [ROW_WINDOW_ITEM]: "" }}
      data-attachment-row={item.key}
      className={cn("flex h-10 items-center", inNote ? "gap-2 px-2" : "gap-3 border-b border-border/60")}
    >
      <AttachmentThumb item={item} resolve={resolve} />
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <Tooltip label={item.path} wide className="flex min-w-0">
          {name}
        </Tooltip>
        {!item.used && (
          <Badge variant="muted" size="sm" className="shrink-0">
            {t(($) => $.notes.attachments.unused)}
          </Badge>
        )}
      </div>
      {item.size !== null && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatBytes(item.size)}</span>}
      {!inNote && (
        <Button
          variant="ghost"
          size="xs"
          className="max-w-[35%] shrink-0 gap-1.5 font-normal text-muted-foreground"
          aria-label={t(($) => $.notes.attachments.openNote, { title })}
          onClick={() => actions.open(item)}
        >
          <NoteChip icon={icon} className="size-4 rounded" />
          <span className="truncate">{title}</span>
        </Button>
      )}
      <span className="flex shrink-0 items-center">
        <TooltipIconButton label={t(($) => $.core.export.showInFolder)} className="text-muted-foreground" onClick={() => actions.reveal(item)}>
          <FolderOpen aria-hidden />
        </TooltipIconButton>
        <TooltipIconButton label={t(($) => $.notes.attachments.copyLink)} className="text-muted-foreground" onClick={() => actions.copy(item)}>
          <Link2 aria-hidden />
        </TooltipIconButton>
      </span>
    </li>
  );
});

function useAttachmentActions(onOpenNote: (id: string) => void): RowActions {
  const { t } = useTranslation(["notes"]);
  const data = useNotesData();
  const latest = useRef({ data, onOpenNote });
  latest.current = { data, onOpenNote };
  const open = useCallback((item: NoteAttachment) => {
    const { data: current, onOpenNote: openNote } = latest.current;
    openNote(item.noteId);
    revealAttachment(item.noteId, item.path, current.loadNote).catch((error: unknown) => logError("show an attachment in its note", error));
  }, []);
  const reveal = useCallback((item: NoteAttachment) => noteAssetActions(latest.current.data, item.noteId).reveal?.(item.path), []);
  const copy = useCallback(
    (item: NoteAttachment) => {
      const link = fileLinkSource("markdown", item.path, { fromFile: NOTE_FILE, mainDoc: NOTE_FILE });
      writeClipboardText(link).then(
        () => toast.success(t(($) => $.notes.attachments.linkCopied, { name: item.name })),
        (error: unknown) => notifyError("copy an attachment link", error, t(($) => $.notes.attachments.copyFailed, { name: item.name })),
      );
    },
    [t],
  );
  return useMemo<RowActions>(() => ({ open, reveal, copy }), [copy, open, reveal]);
}

export function NoteAttachmentsSection({ note, onOpenNote }: Readonly<{ note: NoteItem; onOpenNote: (id: string) => void }>) {
  const { t } = useTranslation(["notes"]);
  const data = useNotesData();
  const { loadNote } = data;
  const open = useNotesPrefsStore((state) => state.attachmentsOpen);
  const [known] = useState<AttachmentRows>(() => new Map());
  const load = useMemo(() => () => noteAttachments([note], vaultAttachmentSources(loadNote), known), [known, loadNote, note]);
  const index = useVaultLoad("note-attachments", load, open);
  const actions = useAttachmentActions(onOpenNote);
  const items = index.data;
  if (index.failed && !items) return null;
  return (
    <NoteLinkSection
      title={t(($) => $.notes.attachments.list)}
      open={open}
      count={items?.length}
      empty={t(($) => $.notes.info.noAttachments)}
      onOpenChange={(next) => useNotesPrefsStore.getState().set("attachmentsOpen", next)}
      aria-busy={open && !items}
    >
      {items?.map((item) => (
        <AttachmentRow key={item.key} item={item} note={note} icon={note.icon} resolve={data.resolveAsset} actions={actions} inNote />
      ))}
    </NoteLinkSection>
  );
}

export function NotesAttachments({ search, scrollRef, iconFor, onOpenNote }: Readonly<NotesAttachmentsProps>) {
  const { t } = useTranslation(["notes"]);
  const data = useNotesData();
  const { notes, loadNote } = data;
  const latest = useRef(data);
  latest.current = data;
  const [known] = useState<AttachmentRows>(() => new Map());
  const load = useMemo(
    () => () => noteAttachments(notes, vaultAttachmentSources(loadNote), known, latest.current.changedNotes),
    [known, loadNote, notes],
  );
  const index = useVaultLoad("attachments", load);
  const [type, setType] = useState<AttachmentTypeFilter>("all");
  const [use, setUse] = useState<AttachmentUse>("all");
  const listRef = useRef<HTMLUListElement>(null);
  const notesById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);
  const entries = index.data;
  const shown = useMemo(
    () => (entries ? filterAttachments(entries, { type, use, search }, (id) => notesById.get(id)?.title ?? "") : []),
    [entries, notesById, search, type, use],
  );
  const rows = useRowWindow({ count: shown.length, scrollRef, listRef, unmeasuredCount: UNMEASURED_ROWS });

  const actions = useAttachmentActions(onOpenNote);

  const filtered = type !== "all" || use !== "all";
  const filters = (
    <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-1 border-0 p-0" aria-label={t(($) => $.notes.attachments.filters)}>
      <FilterMenu
        label={t(($) => $.notes.attachments.type.label)}
        value={type}
        active={type !== "all"}
        options={ATTACHMENT_TYPES.map((value) => ({ value, label: t(($) => $.notes.attachments.type[value]) }))}
        onChange={setType}
      />
      <FilterMenu
        label={t(($) => $.notes.attachments.use.label)}
        value={use}
        active={use !== "all"}
        options={ATTACHMENT_USES.map((value) => ({ value, label: t(($) => $.notes.attachments.use[value]) }))}
        onChange={setUse}
      />
      {filtered && (
        <Button
          variant="link"
          size="sm"
          className="px-2"
          onClick={() => {
            setType("all");
            setUse("all");
          }}
        >
          {t(($) => $.notes.attachments.clear)}
        </Button>
      )}
    </fieldset>
  );

  const body = () => {
    if (index.failed && !entries) return <ErrorState message={t(($) => $.notes.attachments.failed)} className="px-1 py-8" />;
    if (!entries) return <LoadingState label={t(($) => $.notes.attachments.loading)} className="px-1 py-8" />;
    if (shown.length === 0) {
      const none = entries.length === 0;
      return (
        <EmptyState
          icon={<EmptyMedia variant="icon">{none ? <Paperclip aria-hidden className="size-6" /> : <SearchX aria-hidden className="size-6" />}</EmptyMedia>}
          description={none ? t(($) => $.notes.attachments.empty) : t(($) => $.notes.attachments.noMatches)}
          className="px-6 pb-16 pt-20"
        />
      );
    }
    return (
      <ul
        ref={listRef}
        aria-label={t(($) => $.notes.attachments.list)}
        className="m-0 list-none p-0"
        style={{ paddingTop: rows.paddingTop, paddingBottom: rows.paddingBottom }}
      >
        {shown.slice(rows.start, rows.end).map((item) => {
          const note = notesById.get(item.noteId);
          return (
            <AttachmentRow
              key={item.key}
              item={item}
              note={note}
              icon={note ? iconFor(note) : undefined}
              resolve={data.resolveAsset}
              actions={actions}
            />
          );
        })}
      </ul>
    );
  };

  return (
    <div data-notes-attachments className="px-6 pb-8 pt-2.5">
      <div className="flex items-center justify-between gap-3 pb-2">
        {filters}
        {entries && shown.length > 0 && (
          <span className="shrink-0 text-xs text-muted-foreground">{t(($) => $.notes.attachments.count, { count: shown.length })}</span>
        )}
      </div>
      {body()}
    </div>
  );
}
