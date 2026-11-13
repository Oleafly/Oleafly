import { NotebookPen, Plus } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SIDEBAR_TITLE_CLASS, SidebarPanelHeader } from "@/components/layout/SidebarSection";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { EmptyState, LoadingState } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { SearchField } from "@/components/ui/search-field";
import { Spinner } from "@/components/ui/spinner";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { isImeEnter } from "@/components/ai/composer/ime";
import { openNotes } from "@/features/open-tool";
import { useCollabProjectShared } from "@/lib/collab-live-bridge";
import { formatRelativeTimeFrom } from "@/lib/intl";
import { logError } from "@/lib/log";
import { deleteProjectEntry } from "@/lib/project-file-delete";
import { projectNoteKey } from "@/lib/project-notes";
import { type NoteFacts, noteFacts } from "@/lib/tauri";
import { notifyError, toast } from "@/lib/toast";
import { cn, isWindows } from "@/lib/utils";
import { i18n } from "@/i18n";
import { confirmAction } from "@/store/confirm-dialog";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useNoteActions } from "./note-actions";
import { NoteChip } from "./note-icons";
import { forgetNoteLeftovers } from "./note-pending-suggestions";
import { NoteListItem, NoteRowMenu } from "./NoteListItem";
import { useNoteActionsData } from "./note-tab-data";
import { NotesDataProvider, useNotesData } from "./notes-data";
import {
  copyProjectNoteToMine,
  createProjectNoteFile,
  moveNoteIntoProject,
  openPersonalNoteTab,
  renameProjectNote,
} from "./project-note-actions";
import {
  matchesProjectNote,
  projectNoteProjects,
  projectNotes,
  startProjectNote,
  type ProjectNote,
} from "./project-notes";
import type { NoteItem } from "./types";
import { type ProjectNoteFile, useProjectNoteFiles } from "./use-project-note-files";
import "./notes.css";

export const PROJECT_NOTES_SEARCH_MIN = 8;

interface RowAction {
  id: string;
  label: string;
  run: () => void;
}

function NoteRow({
  testId,
  title,
  meta,
  summary,
  icon,
  color,
  actions,
  onOpen,
}: Readonly<{
  testId: string;
  title: string;
  meta?: string;
  summary: string;
  icon?: string;
  color?: string;
  actions: readonly RowAction[];
  onOpen: () => void;
}>) {
  const { t } = useTranslation(["notes"]);
  return (
    <li>
      <NoteListItem
        data-testid={testId}
        icon={<NoteChip icon={icon} color={color} />}
        title={title}
        meta={meta}
        snippet={summary}
        onClick={onOpen}
        trailing={
          <NoteRowMenu label={t(($) => $.notes.projectNotes.noteActions, { title })} testId={`${testId}-menu`}>
            {actions.map((action) => (
              <DropdownMenuItem key={action.id} data-testid={`${testId}-${action.id}`} onSelect={action.run}>
                {action.label}
              </DropdownMenuItem>
            ))}
          </NoteRowMenu>
        }
      />
    </li>
  );
}

function NoteGroup({
  title,
  newLabel,
  busy,
  disabled,
  onNew,
  testId,
  children,
}: Readonly<{
  title: string;
  newLabel: string;
  busy: boolean;
  disabled: boolean;
  onNew: () => void;
  testId: string;
  children: ReactNode;
}>) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-testid={testId} className="flex flex-col gap-0.5">
      <div className="flex h-7 items-center gap-1 pl-2 pr-0.5">
        <h3 id={headingId} className={cn("min-w-0 flex-1 truncate", SIDEBAR_TITLE_CLASS)}>
          {title}
        </h3>
        <TooltipIconButton label={newLabel} data-testid={`${testId}-new`} disabled={disabled || busy} onClick={onNew} className="size-6">
          {busy ? <Spinner size="sm" /> : <Plus aria-hidden />}
        </TooltipIconButton>
      </div>
      {children}
    </section>
  );
}

function NoteTitleField({
  initial,
  label,
  testId,
  onCommit,
  onCancel,
}: Readonly<{
  initial: string;
  label: string;
  testId: string;
  onCommit: (title: string) => Promise<void>;
  onCancel: () => void;
}>) {
  const { t } = useTranslation(["notes"]);
  const [title, setTitle] = useState(initial);
  const [busy, setBusy] = useState(false);
  const submit = () => {
    if (busy) return;
    if (title.trim() === "" || title === initial) {
      onCancel();
      return;
    }
    setBusy(true);
    void onCommit(title).finally(() => setBusy(false));
  };
  return (
    <div className="px-1.5 pb-1">
      <Input
        autoFocus
        value={title}
        disabled={busy}
        data-testid={testId}
        aria-label={label}
        placeholder={t(($) => $.notes.projectNotes.titlePlaceholder)}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (isImeEnter(event)) {
            if (event.key === "Escape") event.stopPropagation();
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        onBlur={() => {
          if (!busy) submit();
        }}
        className="h-8 text-xs"
      />
    </div>
  );
}

function personalNoteItem(note: ProjectNote, projectId: string): NoteItem {
  return {
    id: note.id,
    title: note.title,
    project: "",
    relatedProjectId: projectId,
    updatedAt: note.updatedAt,
    author: "you",
    color: note.color,
    summary: note.summary,
  };
}

function deleteLabel(trashed: boolean): string {
  if (!trashed) return i18n.t(($) => $.common.actions.delete);
  return isWindows ? i18n.t(($) => $.notes.projectNotes.trashWindows) : i18n.t(($) => $.notes.projectNotes.trash);
}

function deleteQuestion(title: string, trashed: boolean): { title: string; message: string } {
  const name = { name: title };
  if (!trashed) {
    return { title: i18n.t(($) => $.notes.projectNotes.deleteTitle, name), message: i18n.t(($) => $.notes.projectNotes.deleteMessage) };
  }
  if (isWindows) {
    return {
      title: i18n.t(($) => $.notes.projectNotes.trashTitleWindows, name),
      message: i18n.t(($) => $.notes.projectNotes.trashMessageWindows),
    };
  }
  return { title: i18n.t(($) => $.notes.projectNotes.trashTitle, name), message: i18n.t(($) => $.notes.projectNotes.trashMessage) };
}

async function deleteProjectNote(projectId: string, path: string, title: string, trashed: boolean): Promise<void> {
  const confirmed = await confirmAction({ ...deleteQuestion(title, trashed), confirmLabel: deleteLabel(trashed), destructive: true });
  if (!confirmed) return;
  if (await deleteProjectEntry(path)) forgetNoteLeftovers(projectNoteKey(projectId, path));
}

const NO_FACTS: readonly NoteFacts[] = [];

function useLinkedNoteFacts(projectId: string | null, keys: string, notesOpen: boolean): readonly NoteFacts[] {
  const [facts, setFacts] = useState(NO_FACTS);
  const refreshProjects = useFilesStore((state) => state.refreshProjects);
  const seen = useRef(notesOpen);

  useEffect(() => {
    const closed = seen.current && !notesOpen;
    seen.current = notesOpen;
    if (!closed) return;
    refreshProjects().catch((error: unknown) => logError("refresh projects after closing notes", error));
  }, [notesOpen, refreshProjects]);

  useEffect(() => {
    if (notesOpen || !keys || !projectId) return;
    let live = true;
    noteFacts({ relatedProject: projectId }).then(
      (list) => {
        if (live) setFacts(list);
      },
      (error: unknown) => void logError("read project note facts", error),
    );
    return () => {
      live = false;
    };
  }, [keys, notesOpen, projectId]);

  return facts;
}

function matchesFile(note: ProjectNoteFile, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return !needle || `${note.title}\n${note.summary}`.toLocaleLowerCase().includes(needle);
}

export function ProjectNotesPanel() {
  const data = useNoteActionsData();
  return (
    <NotesDataProvider value={data}>
      <ProjectNotesList />
    </NotesDataProvider>
  );
}

function ProjectNotesList() {
  const { t } = useTranslation(["notes", "shell", "common"]);
  const projectId = useFilesStore((state) => state.projectId);
  const projects = useFilesStore((state) => state.projects);
  const listedShared = useFilesStore((state) =>
    Boolean(state.projects.find((project) => project.id === state.projectId)?.shared),
  );
  const liveShared = useCollabProjectShared(projectId);
  const trashed = useFilesStore((state) => state.manifestHome !== "library");
  const notesOpen = useHomeViewStore((state) => state.page === "notes");
  const [query, setQuery] = useState("");
  const [creatingFile, setCreatingFile] = useState(false);
  const [renaming, setRenaming] = useState<{ kind: "file" | "mine"; key: string } | null>(null);
  const [creatingMine, setCreatingMine] = useState(false);
  const noteActions = useNoteActions();
  const { setRelatedProject } = useNotesData();

  const linked = useMemo(() => projectNoteProjects(projects, projectId), [projectId, projects]);
  const keys = linked.map((project) => `${project.id}:${project.updated_at}`).join("|");
  const facts = useLinkedNoteFacts(projectId, keys, notesOpen);
  const mine = useMemo(() => projectNotes(projects, projectId, facts), [facts, projectId, projects]);
  const files = useProjectNoteFiles(projectId);
  const searchable = mine.length + files.notes.length > PROJECT_NOTES_SEARCH_MIN;
  const shownMine = searchable ? mine.filter((note) => matchesProjectNote(note, query)) : mine;
  const shownFiles = searchable ? files.notes.filter((note) => matchesFile(note, query)) : files.notes;
  const shared = listedShared || liveShared;

  const createFile = () => {
    if (!projectId || creatingFile) return;
    setCreatingFile(true);
    void createProjectNoteFile(projectId, "")
      .then((path) => {
        if (path !== null) setRenaming({ kind: "file", key: path });
      })
      .finally(() => setCreatingFile(false));
  };

  const renameFile = async (path: string, title: string) => {
    if (!projectId) return;
    if ((await renameProjectNote(projectId, path, title)) !== null) setRenaming(null);
  };

  const createMine = () => {
    if (!projectId || creatingMine) return;
    setCreatingMine(true);
    void startProjectNote(projectId).finally(() => setCreatingMine(false));
  };

  const fileActions = (note: ProjectNoteFile): RowAction[] =>
    projectId
      ? [
          {
            id: "copy",
            label: t(($) => $.notes.noteTab.copyToMine),
            run: () => void copyProjectNoteToMine(projectId, note.path),
          },
          {
            id: "rename",
            label: t(($) => $.notes.library.menu.rename),
            run: () => setRenaming({ kind: "file", key: note.path }),
          },
          {
            id: "delete",
            label: deleteLabel(trashed),
            run: () => void deleteProjectNote(projectId, note.path, note.title, trashed),
          },
        ]
      : [];

  const unlink = (note: ProjectNote, from: string) => {
    if (!setRelatedProject) return;
    const relink = () =>
      void setRelatedProject(note.id, from).catch((error: unknown) =>
        notifyError("link a note back to the project", error, t(($) => $.notes.failures.linkNote, { name: note.title })),
      );
    setRelatedProject(note.id, null).then(
      () =>
        toast.success(t(($) => $.notes.projectNotes.unlinked, { title: note.title }), {
          label: t(($) => $.notes.projectNotes.undoUnlink),
          onClick: relink,
        }),
      (error: unknown) =>
        notifyError("unlink a note from the project", error, t(($) => $.notes.projectNotes.unlinkFailed, { title: note.title })),
    );
  };

  const mineActions = (note: ProjectNote): RowAction[] => {
    if (!projectId) return [];
    const actions = noteActions.actionsFor(personalNoteItem(note, projectId));
    const rows: RowAction[] = [
      {
        id: "move",
        label: t(($) => $.notes.noteTab.moveIntoProject),
        run: () => void moveNoteIntoProject(note.id, projectId),
      },
      { id: "open", label: t(($) => $.notes.noteTab.openInNotes), run: () => void openNotes(note.id) },
    ];
    if (actions.rename) {
      rows.push({
        id: "rename",
        label: t(($) => $.notes.library.menu.rename),
        run: () => setRenaming({ kind: "mine", key: note.id }),
      });
    }
    if (setRelatedProject) {
      rows.push({ id: "unlink", label: t(($) => $.notes.projectNotes.unlink), run: () => unlink(note, projectId) });
    }
    const remove = actions.remove;
    if (remove) rows.push({ id: "delete", label: t(($) => $.notes.library.menu.deleteConfirm), run: remove });
    return rows;
  };


  const renameMine = (note: ProjectNote, title: string): Promise<void> => {
    if (projectId) {
      noteActions.actionsFor(personalNoteItem(note, projectId)).rename?.(title.trim());
      setRenaming(null);
    }
    return Promise.resolve();
  };

  const empty = (text: string, testId: string) => (
    <EmptyState size="compact" description={text} testId={testId} className="items-start px-2 pb-2 text-left" />
  );

  const noMatches =
    searchable && query.trim() !== "" && shownMine.length === 0 && shownFiles.length === 0 ? (
      <output className="block py-4">
        <EmptyState size="compact" description={t(($) => $.notes.projectNotes.noMatches)} />
      </output>
    ) : null;

  const fileList = () => {
    if (!files.loaded) {
      return <LoadingState size="compact" label={t(($) => $.notes.projectNotes.loading)} className="px-2 py-1.5" />;
    }
    const pending =
      renaming?.kind === "file" && !files.notes.some((note) => note.path === renaming.key) ? renaming.key : null;
    const more =
      files.more > 0 ? (
        <p data-testid="project-files-more" className="px-2 pb-1 text-xs text-muted-foreground">
          {t(($) => $.notes.projectNotes.moreFiles, { count: files.more })}
        </p>
      ) : null;
    if (files.notes.length === 0 && pending === null) {
      return (
        <>
          {empty(t(($) => $.notes.projectNotes.projectEmpty), "project-files-empty")}
          {more}
        </>
      );
    }
    return (
      <>
        {pending !== null ? (
          <NoteTitleField
            initial={t(($) => $.notes.document.untitled)}
            label={t(($) => $.notes.projectNotes.titleLabel)}
            testId="project-note-title"
            onCommit={(title) => renameFile(pending, title)}
            onCancel={() => setRenaming(null)}
          />
        ) : null}
        <ul aria-label={t(($) => $.notes.projectNotes.projectGroup)} className="flex flex-col gap-0.5">
          {shownFiles.map((note) =>
            renaming?.kind === "file" && renaming.key === note.path ? (
              <li key={note.path}>
                <NoteTitleField
                  initial={note.title}
                  label={t(($) => $.notes.projectNotes.titleLabel)}
                  testId="project-note-title"
                  onCommit={(title) => renameFile(note.path, title)}
                  onCancel={() => setRenaming(null)}
                />
              </li>
            ) : (
              <NoteRow
                key={note.path}
                testId="project-note-file"
                title={note.title}
                summary={note.summary}
                icon={note.icon}
                color={note.color}
                actions={fileActions(note)}
                onOpen={() => void useFilesStore.getState().openFile(note.path)}
              />
            ),
          )}
        </ul>
        {more}
      </>
    );
  };

  const mineList = () => {
    const now = Date.now();
    if (mine.length === 0) return empty(t(($) => $.notes.projectNotes.mineEmpty), "project-notes-empty");
    return (
      <ul aria-label={t(($) => $.notes.projectNotes.mineGroup)} className="flex flex-col gap-0.5">
        {shownMine.map((note) =>
          renaming?.kind === "mine" && renaming.key === note.id ? (
            <li key={note.id}>
              <NoteTitleField
                initial={note.title}
                label={t(($) => $.notes.library.menu.renameLabel)}
                testId="project-note-rename"
                onCommit={(title) => renameMine(note, title)}
                onCancel={() => setRenaming(null)}
              />
            </li>
          ) : (
            <NoteRow
              key={note.id}
              testId="project-note"
              title={note.title}
              meta={t(($) => $.notes.projectNotes.edited, {
                when: formatRelativeTimeFrom(note.updatedAt, now, { dateAfterDays: 7 }),
              })}
              summary={note.summary}
              icon={note.icon}
              color={note.color}
              actions={mineActions(note)}
              onOpen={() => {
                if (projectId) openPersonalNoteTab(projectId, note.id, { icon: note.icon, color: note.color });
              }}
            />
          ),
        )}
      </ul>
    );
  };

  return (
    <div className="flex h-full flex-col" data-testid="project-notes-panel">
      <SidebarPanelHeader icon={NotebookPen} title={t(($) => $.shell.rail.notes)} />
      {searchable ? (
        <SearchField
          className="mx-1.5 mt-1.5 shrink-0"
          value={query}
          onChange={setQuery}
          label={t(($) => $.notes.projectNotes.searchLabel)}
          placeholder={t(($) => $.notes.projectNotes.searchPlaceholder)}
          clearLabel={t(($) => $.notes.projectNotes.clearSearch)}
        />
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-1.5">
        {shared ? (
          <p data-testid="project-notes-shared" className="rounded-md bg-primary/5 px-2 py-1.5 text-xs text-muted-foreground">
            {t(($) => $.notes.projectNotes.sharedLine)}
          </p>
        ) : null}
        {noMatches}
        <NoteGroup
          testId="project-notes-files"
          title={t(($) => $.notes.projectNotes.projectGroup)}
          newLabel={t(($) => $.notes.projectNotes.newProjectNote)}
          busy={creatingFile}
          disabled={!projectId}
          onNew={createFile}
        >
          {fileList()}
        </NoteGroup>
        <NoteGroup
          testId="project-notes-mine"
          title={t(($) => $.notes.projectNotes.mineGroup)}
          newLabel={t(($) => $.notes.projectNotes.newPersonalNote)}
          busy={creatingMine}
          disabled={!projectId}
          onNew={createMine}
        >
          {mineList()}
          {mine.length > 0 ? (
            <p data-testid="project-notes-device" className="px-2 pb-1 text-xs text-muted-foreground">
              {t(($) => $.notes.projectNotes.mineDeviceOnly)}
            </p>
          ) : null}
        </NoteGroup>
      </div>
      {noteActions.dialog}
    </div>
  );
}
