import { Bookmark, BookmarkX, Copy, FileDiff, FileOutput, History, LayoutTemplate, Link, Link2, MessageSquareDiff, PanelsTopLeft, Pencil, Share2, Trash2 } from "lucide-react";
import type { TFunction } from "i18next";
import { Suspense, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { isImeEnter } from "@/components/ai/composer/ime";
import type { ConflictCopy } from "@/components/cloud/ConflictCopyDialog";
import { CheckBadge } from "@/components/ui/check-badge";
import { ColorDot } from "@/components/ui/color-swatch";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useInitialFocus } from "@/components/ui/use-initial-focus";
import { loadNamespace } from "@/i18n";
import { writeClipboardText } from "@/lib/clipboard";
import { frontMatterBody } from "@/lib/front-matter";
import { flushOpenNotes } from "@/lib/open-note-editors";
import { lazy } from "@/lib/preloadable";
import { shortProjectName } from "@/lib/project-format";
import { notifyError, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useCloudStore } from "@/store/cloud";
import { useFilesStore } from "@/store/files";
import { useNoteFavorites, useNotesPrefsStore } from "@/store/notes-prefs";
import { useProjectColor } from "./project-color";
import { readNoteFacts } from "./note-file";
import type { NoteExportFormat } from "./note-export";
import { isLinkableId, noteLinkHref } from "./note-link-format";
import { isTemplateNote, withTemplateFlag } from "./note-templates";
import { noteVersionFile } from "./note-versions";
import { announceExport, exportFolder } from "./note-vault";
import { RowMark } from "./NoteListItem";
import { useWaitingSuggestions } from "./note-pending-suggestions";
import { type NotesData, useNotesData } from "./notes-data";
import type { NoteItem } from "./types";

const NoteVersionHistory = lazy(() =>
  Promise.all([import("./NoteVersionHistory"), loadNamespace("editor")]).then(([module]) => module),
);

const ConflictCopyDialog = lazy(() =>
  Promise.all([import("@/components/cloud/ConflictCopyDialog"), loadNamespace("cloud")]).then(([module]) => module),
);

export interface NoteActions {
  openInNewTab?: () => void;
  favorite?: { on: boolean; toggle: () => void };
  rename?: (title: string) => void;
  move?: { projects: readonly { id: string; name: string }[]; to: (projectId: string | null) => void };
  template?: { on: boolean; toggle: () => void };
  remove?: () => void;
  share?: () => void;
  copyLink?: () => void;
  duplicate?: () => void;
  conflict?: () => void;
  history?: () => void;
  exportAs?: (choice: NoteExportChoice) => void;
  copyMarkdown?: () => void;
}

export type NoteExportChoice = "markdown" | NoteExportFormat;

const EXPORT_CHOICES: readonly NoteExportChoice[] = ["markdown", "docx", "html", "latex", "typst"];

export type MenuKit = Readonly<{
  Item: typeof ContextMenuItem;
  Separator: typeof ContextMenuSeparator;
  Sub: typeof ContextMenuSub;
  SubTrigger: typeof ContextMenuSubTrigger;
  SubContent: typeof ContextMenuSubContent;
}>;

export const CONTEXT_MENU_KIT: MenuKit = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};

export const DROPDOWN_MENU_KIT: MenuKit = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};

const MENU_ITEM = "gap-2 [&>svg]:size-4 [&>svg]:shrink-0";

export function hasNoteMenu(actions: NoteActions): boolean {
  return Boolean(
    actions.openInNewTab ||
      actions.share ||
      actions.copyLink ||
      actions.duplicate ||
      actions.favorite ||
      actions.rename ||
      actions.move ||
      actions.template ||
      actions.remove ||
      actions.conflict ||
      actions.history ||
      actions.exportAs ||
      actions.copyMarkdown,
  );
}

export function NoteExportItems({ kit, actions }: Readonly<{ kit: MenuKit; actions: NoteActions }>) {
  const { t } = useTranslation(["notes"]);
  const { Item, Separator } = kit;
  const { exportAs, copyMarkdown } = actions;
  return (
    <>
      {exportAs &&
        EXPORT_CHOICES.map((choice) => (
          <Item key={choice} onSelect={() => exportAs(choice)}>
            {t(($) => $.notes.library.menu.exportAs[choice])}
          </Item>
        ))}
      {exportAs && copyMarkdown && <Separator />}
      {copyMarkdown && <Item onSelect={copyMarkdown}>{t(($) => $.notes.library.menu.copyMarkdown)}</Item>}
    </>
  );
}

export function NoteMenuItems({
  note,
  kit,
  actions,
  onRename,
  onDelete,
}: Readonly<{ note: NoteItem; kit: MenuKit; actions: NoteActions; onRename: () => void; onDelete: () => void }>) {
  const { t } = useTranslation(["notes"]);
  const colorOf = useProjectColor();
  const { Item, Separator, Sub, SubTrigger, SubContent } = kit;
  const { openInNewTab, favorite, rename, move, template, remove, share, copyLink, duplicate, conflict, history, exportAs, copyMarkdown } = actions;
  const current = note.relatedProjectId ?? null;
  const choose = (projectId: string | null) => {
    if (move && projectId !== current) move.to(projectId);
  };
  return (
    <>
      {openInNewTab && (
        <Item className={MENU_ITEM} onSelect={openInNewTab}>
          <PanelsTopLeft aria-hidden />
          {t(($) => $.notes.library.menu.openInNewTab)}
        </Item>
      )}
      {conflict && (
        <Item className={MENU_ITEM} onSelect={conflict}>
          <FileDiff aria-hidden />
          {t(($) => $.notes.library.menu.compareConflict)}
        </Item>
      )}
      {share && (
        <Item className={MENU_ITEM} onSelect={share}>
          <Share2 aria-hidden />
          {t(($) => $.notes.live.share)}
        </Item>
      )}
      {copyLink && (
        <Item className={MENU_ITEM} onSelect={copyLink}>
          <Link aria-hidden />
          {t(($) => $.notes.library.menu.copyLink)}
        </Item>
      )}
      {duplicate && (
        <Item className={MENU_ITEM} onSelect={duplicate}>
          <Copy aria-hidden />
          {t(($) => $.notes.library.menu.duplicate)}
        </Item>
      )}
      {history && (
        <Item className={MENU_ITEM} onSelect={history}>
          <History aria-hidden />
          {t(($) => $.notes.versions.title)}
        </Item>
      )}
      {(exportAs || copyMarkdown) && (
        <Sub>
          <SubTrigger className={MENU_ITEM}>
            <FileOutput aria-hidden />
            {t(($) => $.notes.library.menu.export)}
          </SubTrigger>
          <SubContent className="w-56">
            <NoteExportItems kit={kit} actions={actions} />
          </SubContent>
        </Sub>
      )}
      {favorite && (
        <Item className={MENU_ITEM} onSelect={favorite.toggle}>
          {favorite.on ? <BookmarkX aria-hidden /> : <Bookmark aria-hidden />}
          {favorite.on ? t(($) => $.notes.library.menu.unfavorite) : t(($) => $.notes.library.menu.favorite)}
        </Item>
      )}
      {rename && (
        <Item className={MENU_ITEM} onSelect={onRename}>
          <Pencil aria-hidden />
          {t(($) => $.notes.library.menu.rename)}
        </Item>
      )}
      {template && (
        <Item className={MENU_ITEM} onSelect={template.toggle}>
          <LayoutTemplate aria-hidden />
          {template.on ? t(($) => $.notes.library.menu.stopTemplate) : t(($) => $.notes.library.menu.useAsTemplate)}
        </Item>
      )}
      {move && (
        <Sub>
          <SubTrigger className={MENU_ITEM}>
            <Link2 aria-hidden />
            {t(($) => $.notes.library.menu.linkProject)}
          </SubTrigger>
          <SubContent className="max-h-80 w-56 overflow-y-auto">
            <Item className="gap-2" onSelect={() => choose(null)}>
              <ColorDot color="transparent" size="xs" />
              <span className="min-w-0 flex-1 truncate">{t(($) => $.notes.workspace.noProject)}</span>
              {current === null && <CheckBadge />}
            </Item>
            {move.projects.map((project) => (
              <Item key={project.id} className="gap-2" onSelect={() => choose(project.id)}>
                <ColorDot color={colorOf(project.id) ?? "transparent"} size="xs" />
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                {current === project.id && <CheckBadge />}
              </Item>
            ))}
          </SubContent>
        </Sub>
      )}
      {remove && (
        <>
          {(openInNewTab || conflict || share || copyLink || duplicate || history || exportAs || copyMarkdown || favorite || rename || template || move) && <Separator />}
          <Item className={cn(MENU_ITEM, "text-destructive focus:text-destructive")} onSelect={onDelete}>
            <Trash2 aria-hidden />
            {t(($) => $.notes.library.menu.delete)}
          </Item>
        </>
      )}
    </>
  );
}

export function ConflictMark({ className }: Readonly<{ className?: string }>) {
  const { t } = useTranslation(["notes"]);
  return (
    <RowMark
      label={t(($) => $.notes.library.conflicts.badge)}
      icon={FileDiff}
      data-note-conflict=""
      className={cn("text-amber-600 dark:text-amber-400", className)}
    />
  );
}

export function SuggestionsMark({ noteId, className }: Readonly<{ noteId: string; className?: string }>) {
  const { t } = useTranslation(["notes"]);
  if (!useWaitingSuggestions(noteId)) return null;
  return (
    <RowMark
      label={t(($) => $.notes.library.suggestions.badge)}
      icon={MessageSquareDiff}
      data-note-suggestions=""
      className={cn("text-primary", className)}
    />
  );
}

function useNoteConflicts(): ReadonlyMap<string, readonly string[]> {
  const projects = useCloudStore((state) => state.state?.projects);
  return useMemo(
    () =>
      new Map(
        (projects ?? []).flatMap((project): [string, readonly string[]][] =>
          project.localId && project.conflictCopies.length > 0 ? [[project.localId, project.conflictCopies]] : [],
        ),
      ),
    [projects],
  );
}

function mainDocOf(projectId: string): string | null {
  return useFilesStore.getState().projects.find((project) => project.id === projectId)?.main_doc ?? null;
}

export function NoteConflictHost({ conflict, onClose }: Readonly<{ conflict: ConflictCopy | null; onClose: () => void }>) {
  if (!conflict) return null;
  return (
    <Suspense fallback={null}>
      <ConflictCopyDialog conflict={conflict} onClose={onClose} />
    </Suspense>
  );
}

export function NoteRenameInput({
  title,
  className,
  onDone,
}: Readonly<{ title: string; className?: string; onDone: (title: string | null) => void }>) {
  const { t } = useTranslation(["notes"]);
  const [value, setValue] = useState(title);
  const inputRef = useInitialFocus<HTMLInputElement>();
  const finished = useRef(false);
  const finish = (next: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone(next);
  };
  return (
    <Input
      ref={inputRef}
      aria-label={t(($) => $.notes.library.menu.renameLabel)}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => finish(value)}
      onKeyDown={(event) => {
        if (isImeEnter(event)) return;
        if (event.key === "Enter") finish(value);
        else if (event.key === "Escape") {
          event.stopPropagation();
          finish(null);
        }
      }}
      className={cn("min-w-0 flex-1", className)}
    />
  );
}

interface PendingDelete {
  title: string;
  remove: () => Promise<void>;
}

type NotesT = TFunction<["notes"]>;

function copyNoteLink(note: NoteItem, loadNote: NotesData["loadNote"], t: NotesT): void {
  const copy = async () => {
    const id = readNoteFacts((await loadNote(note.id)).text).id;
    if (!isLinkableId(id)) throw new Error("the note has no link id");
    await writeClipboardText(noteLinkHref("note", id));
  };
  copy().then(
    () => toast.success(t(($) => $.notes.library.menu.linkCopied, { name: note.title })),
    (error: unknown) => notifyError("copy a note link", error, t(($) => $.notes.library.menu.copyLinkFailed, { name: note.title })),
  );
}

function noteDuplicator(note: NoteItem, duplicateNote: NotesData["duplicateNote"], onOpen: ((id: string) => void) | undefined, t: NotesT): (() => void) | undefined {
  if (!duplicateNote) return undefined;
  return () =>
    void duplicateNote(note.id, t(($) => $.notes.library.menu.copyTitle, { name: note.title })).then(
      (id) => onOpen?.(id),
      (error: unknown) => notifyError("duplicate a note", error, t(($) => $.notes.library.menu.duplicateFailed, { name: note.title })),
    );
}

interface ExportSources {
  loadNote: NotesData["loadNote"];
  projectCitations: NotesData["projectCitations"];
  citations: NotesData["citations"];
}

function exportNoteAs(note: NoteItem, choice: NoteExportChoice, sources: ExportSources, t: NotesT): void {
  const { loadNote, projectCitations, citations } = sources;
  const run = async () => {
    await flushOpenNotes();
    if (choice === "markdown") {
      const summary = await exportFolder(note);
      if (summary) announceExport(summary);
      return;
    }
    const [{ exportNote }, source, related] = await Promise.all([
      import("./note-export"),
      loadNote(note.id),
      note.relatedProjectId && projectCitations ? projectCitations(note.relatedProjectId).catch(() => []) : [],
    ]);
    await exportNote(
      { noteId: note.id, shared: note.shared, title: note.title, text: source.text, citations: [...related, ...(citations ?? [])] },
      choice,
    );
  };
  run().catch((error: unknown) => notifyError("export a note", error, t(($) => $.notes.library.menu.exportFailed, { name: note.title })));
}

function noteMarkdown(title: string, body: string): string {
  const heading = `# ${title}`;
  return `${[heading, body].filter(Boolean).join("\n\n")}\n`;
}

function copyNoteMarkdown(note: NoteItem, loadNote: NotesData["loadNote"], t: NotesT): void {
  const copy = async () => {
    await flushOpenNotes();
    const body = frontMatterBody((await loadNote(note.id)).text).trim();
    await writeClipboardText(noteMarkdown(note.title, body));
  };
  copy().then(
    () => toast.success(t(($) => $.notes.library.menu.markdownCopied, { name: note.title })),
    (error: unknown) => notifyError("copy a note as Markdown", error, t(($) => $.notes.library.menu.copyMarkdownFailed, { name: note.title })),
  );
}

function noteRenamer(note: NoteItem, renameNote: NotesData["renameNote"], t: NotesT): NoteActions["rename"] {
  if (!renameNote) return undefined;
  return (title) =>
    void renameNote(note.id, title).catch((error: unknown) =>
      notifyError("rename note", error, t(($) => $.notes.library.menu.renameFailed, { name: note.title })),
    );
}

function noteMover(note: NoteItem, projects: NotesData["projects"], setRelatedProject: NotesData["setRelatedProject"], t: NotesT): NoteActions["move"] {
  if (!projects || !setRelatedProject) return undefined;
  return {
    projects,
    to: (projectId) =>
      void setRelatedProject(note.id, projectId).catch((error: unknown) =>
        notifyError("set the note's project", error, t(($) => $.notes.failures.linkNote, { name: note.title })),
      ),
  };
}

function conflictOpener(note: NoteItem, copies: readonly string[] | undefined, compare: (conflict: ConflictCopy) => void): (() => void) | undefined {
  if (!copies) return undefined;
  const mainDoc = mainDocOf(note.id);
  return mainDoc ? () => compare({ projectId: note.id, title: note.title, mainDoc, copies }) : undefined;
}

function toggleTemplate(note: NoteItem, asTemplate: boolean, loadNote: NotesData["loadNote"], saveNote: NotesData["saveNote"], t: NotesT): void {
  const flip = async () => {
    const source = await loadNote(note.id);
    await saveNote(note.id, withTemplateFlag(source.text, !asTemplate), source.version);
  };
  flip().then(
    () =>
      toast.success(
        asTemplate ? t(($) => $.notes.library.menu.templateOff, { name: note.title }) : t(($) => $.notes.library.menu.templateOn, { name: note.title }),
      ),
    (error: unknown) => notifyError("change a note's template flag", error, t(($) => $.notes.failures.template, { name: note.title })),
  );
}

export function useNoteActions(onOpenNoteInNewTab?: (id: string) => void): {
  actionsFor: (note: NoteItem) => NoteActions;
  dialog: ReactNode;
} {
  const { t } = useTranslation(["notes"]);
  const { projects, setRelatedProject, renameNote, deleteNote, duplicateNote, shareNote, loadNote, saveNote, citations, projectCitations } = useNotesData();
  const favorites = useNoteFavorites();
  const conflicts = useNoteConflicts();
  const [deleting, setDeleting] = useState<PendingDelete | null>(null);
  const [comparing, setComparing] = useState<ConflictCopy | null>(null);
  const [versions, setVersions] = useState<NoteItem | null>(null);
  const closeVersions = useCallback(() => setVersions(null), []);

  const actionsFor = useCallback(
    (note: NoteItem): NoteActions => {
      const asTemplate = isTemplateNote(note);
      return {
        conflict: conflictOpener(note, conflicts.get(note.id), setComparing),
        openInNewTab: onOpenNoteInNewTab ? () => onOpenNoteInNewTab(note.id) : undefined,
        history: noteVersionFile(note.id) === null ? undefined : () => setVersions(note),
        share: shareNote ? () => shareNote(note.id) : undefined,
        copyLink: () => copyNoteLink(note, loadNote, t),
        duplicate: noteDuplicator(note, duplicateNote, onOpenNoteInNewTab, t),
        exportAs: (choice) => exportNoteAs(note, choice, { loadNote, projectCitations, citations }, t),
        copyMarkdown: () => copyNoteMarkdown(note, loadNote, t),
        favorite: { on: favorites.has(note.id), toggle: () => useNotesPrefsStore.getState().toggleFavorite(note.id) },
        rename: noteRenamer(note, renameNote, t),
        move: noteMover(note, projects, setRelatedProject, t),
        template: { on: asTemplate, toggle: () => toggleTemplate(note, asTemplate, loadNote, saveNote, t) },
        remove: deleteNote ? () => setDeleting({ title: note.title, remove: () => deleteNote(note.id) }) : undefined,
      };
    },
    [citations, conflicts, deleteNote, duplicateNote, favorites, loadNote, onOpenNoteInNewTab, projectCitations, projects, renameNote, saveNote, setRelatedProject, shareNote, t],
  );

  const confirmDelete = async (target: PendingDelete) => {
    setDeleting(null);
    try {
      await target.remove();
    } catch (error) {
      notifyError("delete note", error, t(($) => $.notes.library.menu.deleteFailed, { name: target.title }));
      return;
    }
    toast.success(t(($) => $.notes.library.menu.deleted, { name: target.title }));
  };

  const dialog = (
    <>
      {deleting && (
        <ConfirmationDialog
          open
          title={t(($) => $.notes.library.menu.deleteTitle, { name: shortProjectName(deleting.title) })}
          description={t(($) => $.notes.library.menu.deleteDescription)}
          confirmLabel={t(($) => $.notes.library.menu.deleteConfirm)}
          destructive
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete(deleting)}
        />
      )}
      <NoteConflictHost conflict={comparing} onClose={() => setComparing(null)} />
      {versions && (
        <Suspense fallback={null}>
          <NoteVersionHistory note={versions} onClose={closeVersions} />
        </Suspense>
      )}
    </>
  );

  return { actionsFor, dialog };
}
