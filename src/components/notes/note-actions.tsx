import { FileDiff, LayoutTemplate, Link2, PanelsTopLeft, Pencil, Share2, Star, StarOff, Trash2 } from "lucide-react";
import { Suspense, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { isImeEnter } from "@/components/ai/composer/ime";
import { CheckBadge } from "@/components/ui/check-badge";
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
import { Tooltip } from "@/components/ui/tooltip";
import { useInitialFocus } from "@/components/ui/use-initial-focus";
import { lazy } from "@/lib/preloadable";
import { shortProjectName } from "@/lib/project-format";
import { notifyError, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useCloudStore } from "@/store/cloud";
import { useFilesStore } from "@/store/files";
import { toggleNoteFavorite, useNoteFavorites } from "./note-favorites";
import { isTemplateNote, withTemplateFlag } from "./note-templates";
import { useNotesData } from "./notes-data";
import { ProjectDot, useProjectColor } from "./project-color";
import type { NoteConflict } from "./NoteConflictDialog";
import type { NoteItem } from "./types";

const NoteConflictDialog = lazy(() => import("./NoteConflictDialog"));

export interface NoteActions {
  openInNewTab?: () => void;
  favorite?: { on: boolean; toggle: () => void };
  rename?: (title: string) => void;
  move?: { projects: readonly { id: string; name: string }[]; to: (projectId: string | null) => void };
  template?: { on: boolean; toggle: () => void };
  remove?: () => void;
  share?: () => void;
  conflict?: () => void;
}

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
      actions.favorite ||
      actions.rename ||
      actions.move ||
      actions.template ||
      actions.remove ||
      actions.conflict,
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
  const { openInNewTab, favorite, rename, move, template, remove, share, conflict } = actions;
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
      {favorite && (
        <Item className={MENU_ITEM} onSelect={favorite.toggle}>
          {favorite.on ? <StarOff aria-hidden /> : <Star aria-hidden />}
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
              <ProjectDot color={null} />
              <span className="min-w-0 flex-1 truncate">{t(($) => $.notes.workspace.noProject)}</span>
              {current === null && <CheckBadge />}
            </Item>
            {move.projects.map((project) => (
              <Item key={project.id} className="gap-2" onSelect={() => choose(project.id)}>
                <ProjectDot color={colorOf(project.id)} />
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                {current === project.id && <CheckBadge />}
              </Item>
            ))}
          </SubContent>
        </Sub>
      )}
      {remove && (
        <>
          {(openInNewTab || conflict || share || favorite || rename || template || move) && <Separator />}
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
  const label = t(($) => $.notes.library.conflicts.badge);
  return (
    <Tooltip label={label}>
      <span role="img" aria-label={label} data-note-conflict className={cn("flex shrink-0 items-center text-amber-600 dark:text-amber-400", className)}>
        <FileDiff aria-hidden className="size-3.5" />
      </span>
    </Tooltip>
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

export function NoteConflictHost({ conflict, onClose }: Readonly<{ conflict: NoteConflict | null; onClose: () => void }>) {
  if (!conflict) return null;
  return (
    <Suspense fallback={null}>
      <NoteConflictDialog conflict={conflict} onClose={onClose} />
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

export function useNoteActions(onOpenNoteInNewTab?: (id: string) => void): {
  actionsFor: (note: NoteItem) => NoteActions;
  dialog: ReactNode;
} {
  const { t } = useTranslation(["notes"]);
  const { projects, setRelatedProject, renameNote, deleteNote, shareNote, loadNote, saveNote } = useNotesData();
  const favorites = useNoteFavorites();
  const conflicts = useNoteConflicts();
  const [deleting, setDeleting] = useState<PendingDelete | null>(null);
  const [comparing, setComparing] = useState<NoteConflict | null>(null);

  const actionsFor = useCallback(
    (note: NoteItem): NoteActions => {
      const asTemplate = isTemplateNote(note);
      const copies = conflicts.get(note.id);
      const mainDoc = copies ? mainDocOf(note.id) : null;
      return {
        conflict:
          copies && mainDoc ? () => setComparing({ projectId: note.id, title: note.title, mainDoc, copies }) : undefined,
        openInNewTab: onOpenNoteInNewTab ? () => onOpenNoteInNewTab(note.id) : undefined,
        share: shareNote ? () => shareNote(note.id) : undefined,
        favorite: { on: favorites.has(note.id), toggle: () => toggleNoteFavorite(note.id) },
        rename: renameNote
          ? (title) =>
              void renameNote(note.id, title).catch((error: unknown) =>
                notifyError("rename note", error, t(($) => $.notes.library.menu.renameFailed, { name: note.title })),
              )
          : undefined,
        move:
          projects && setRelatedProject
            ? {
                projects,
                to: (projectId) =>
                  void setRelatedProject(note.id, projectId).catch((error: unknown) =>
                    notifyError("set the note's project", error, t(($) => $.notes.failures.linkNote, { name: note.title })),
                  ),
              }
            : undefined,
        template: {
          on: asTemplate,
          toggle: () => {
            const flip = async () => {
              const source = await loadNote(note.id);
              await saveNote(note.id, withTemplateFlag(source.text, !asTemplate), source.version);
            };
            flip().then(
              () =>
                toast.success(
                  asTemplate
                    ? t(($) => $.notes.library.menu.templateOff, { name: note.title })
                    : t(($) => $.notes.library.menu.templateOn, { name: note.title }),
                ),
              (error: unknown) => notifyError("change a note's template flag", error, t(($) => $.notes.failures.template, { name: note.title })),
            );
          },
        },
        remove: deleteNote ? () => setDeleting({ title: note.title, remove: () => deleteNote(note.id) }) : undefined,
      };
    },
    [conflicts, deleteNote, favorites, loadNote, onOpenNoteInNewTab, projects, renameNote, saveNote, setRelatedProject, shareNote, t],
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
    </>
  );

  return { actionsFor, dialog };
}
