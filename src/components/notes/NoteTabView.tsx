import { Copy, FileCode, FolderInput, Lock, NotebookPen, Users } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { openNotes } from "@/features/open-tool";
import { useNotesAppearanceRef } from "@/hooks/use-notes-appearance";
import { useCollabProjectShared } from "@/lib/collab-live-bridge";
import { logError } from "@/lib/log";
import { noteFileFacts, noteFileStem, projectNoteKey } from "@/lib/project-notes";
import { useFilesStore } from "@/store/files";
import { useNoteTabsStore } from "@/store/note-tabs";
import { isNoteColor } from "./note-file";
import { projectCitations } from "./note-citations";
import { NoteDocument, type NoteSaveFailure, type SaveStatus } from "./NoteDocument";
import { NoteLiveNotice } from "./NoteLiveNotice";
import { NoteSaveStatus } from "./NoteSaveStatus";
import { NotesDataProvider, type NotesData } from "./notes-data";
import { copyProjectNoteToMine, moveNoteIntoProject, openPersonalNoteTab, renameProjectNote } from "./project-note-actions";
import { createProjectNoteFiles } from "./project-note-data";
import { useLibraryNotesData } from "./note-tab-data";
import type { CitationItem, NoteItem } from "./types";
import "./notes.css";

const NO_CITATIONS: readonly CitationItem[] = [];
const NO_NOTES: readonly NoteItem[] = [];

const TabDocument = memo(NoteDocument);

interface SaveState {
  status: SaveStatus;
  failure: NoteSaveFailure | null;
}

function useSaveState(): [SaveState, (status: SaveStatus, failure: NoteSaveFailure | null) => void] {
  const [state, setState] = useState<SaveState>({ status: "saved", failure: null });
  const report = useCallback((status: SaveStatus, failure: NoteSaveFailure | null) => {
    setState((current) => (current.status === status && current.failure === failure ? current : { status, failure }));
  }, []);
  return [state, report];
}

interface TabHeading {
  noteId: string;
  slug: string;
  id: number;
}

const useTabHeadings = create<{ request: TabHeading | null }>(() => ({ request: null }));
let headingRequests = 0;

function openLinkedNote(projectId: string, noteId: string, heading: string | undefined): void {
  openPersonalNoteTab(projectId, noteId);
  if (!heading) return;
  headingRequests += 1;
  useTabHeadings.setState({ request: { noteId, slug: heading, id: headingRequests } });
}

function useOpenHeading(noteId: string): TabHeading | null {
  const request = useTabHeadings((state) => (state.request?.noteId === noteId ? state.request : null));
  const [heading, setHeading] = useState<TabHeading | null>(null);
  useEffect(() => {
    if (!request) return;
    setHeading(request);
    useTabHeadings.setState((state) => (state.request === request ? { request: null } : state));
  }, [request]);
  return heading;
}

function useOpenLinked(projectId: string) {
  return useCallback(
    (noteId: string, options?: { heading?: string }) => openLinkedNote(projectId, noteId, options?.heading),
    [projectId],
  );
}

function NoteTabButton({
  label,
  icon,
  testId,
  disabled,
  onClick,
}: Readonly<{ label: string; icon: ReactNode; testId: string; disabled?: boolean; onClick: () => void }>) {
  return (
    <Tooltip label={label} side="bottom">
      <Button type="button" variant="ghost" size="xs" data-testid={testId} disabled={disabled} onClick={onClick}>
        {icon}
        <span className="@max-[34rem]:sr-only">{label}</span>
      </Button>
    </Tooltip>
  );
}

function NoteTabBar({
  icon,
  label,
  detail,
  noticeId,
  save,
  children,
}: Readonly<{ icon: ReactNode; label: string; detail: string; noticeId: string; save: SaveState; children: ReactNode }>) {
  return (
    <div
      data-testid="note-tab-bar"
      className="@container flex h-8 min-w-0 shrink-0 items-center gap-2 overflow-hidden border-b px-3 text-xs text-muted-foreground"
    >
      <span data-testid="note-tab-label" className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {icon}
        <span className="min-w-0 shrink-0 truncate font-medium text-foreground @max-[24rem]:shrink">{label}</span>
        <span aria-hidden className="@max-[24rem]:hidden">·</span>
        <span className="min-w-0 truncate @max-[24rem]:hidden">{detail}</span>
      </span>
      <NoteLiveNotice noteId={noticeId} className="max-w-[20rem]" />
      <NoteSaveStatus status={save.status} failure={save.failure} className="min-w-0 max-w-[20rem] truncate" />
      <span className="flex shrink-0 items-center gap-1">{children}</span>
    </div>
  );
}

function useProjectShared(projectId: string): boolean {
  const live = useCollabProjectShared(projectId);
  const listed = useFilesStore((state) => Boolean(state.projects.find((project) => project.id === projectId)?.shared));
  return live || listed;
}

function useProjectCitations(projectId: string): readonly CitationItem[] {
  const [citations, setCitations] = useState<readonly CitationItem[]>(NO_CITATIONS);
  useEffect(() => {
    let live = true;
    projectCitations(projectId).then(
      (found) => {
        if (live) setCitations(found);
      },
      (error: unknown) => void logError("read project citations for a note", error),
    );
    return () => {
      live = false;
    };
  }, [projectId]);
  return citations;
}

function useBusy(): [boolean, (run: () => Promise<unknown>) => void] {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const start = useCallback((run: () => Promise<unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    void run().finally(() => {
      busyRef.current = false;
      setBusy(false);
    });
  }, []);
  return [busy, start];
}

export function ProjectNoteTab({ projectId, path, shown = true }: Readonly<{ projectId: string; path: string; shown?: boolean }>) {
  const { t } = useTranslation(["notes", "editor"]);
  const library = useLibraryNotesData().data;
  const facts = useFilesStore(
    useShallow((state) => noteFileFacts(state.projectId === projectId ? state.files[path]?.content : undefined)),
  );
  const projectName = useFilesStore((state) => state.projectName);
  const shared = useProjectShared(projectId);
  const citations = useProjectCitations(projectId);
  const key = projectNoteKey(projectId, path);
  const refused = t(($) => $.notes.noteTab.writeRefused);
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const refusedRef = useRef(refused);
  refusedRef.current = refused;
  const files = useMemo(
    () =>
      createProjectNoteFiles(
        { projectId, path },
        { key, others: () => libraryRef.current, refused: () => refusedRef.current },
      ),
    [key, path, projectId],
  );
  const title = facts?.title ?? noteFileStem(path);
  const icon = facts?.icon ?? undefined;
  const color = facts?.color && isNoteColor(facts.color) ? facts.color : undefined;
  const live = useMemo(() => ({ projectId, path }), [path, projectId]);
  const [save, report] = useSaveState();
  const [copying, copy] = useBusy();
  const appearanceRef = useNotesAppearanceRef<HTMLDivElement>();
  const openLinked = useOpenLinked(projectId);
  const rename = useCallback(
    async (id: string, name: string) => {
      if (id === key) await renameProjectNote(projectId, path, name);
    },
    [key, path, projectId],
  );

  const note = useMemo<NoteItem>(
    () => ({
      id: key,
      title,
      project: projectName,
      relatedProjectId: projectId,
      updatedAt: 0,
      author: "you",
      icon,
      color,
      summary: "",
      home: { projectId, path },
      ...(shared ? { shared: true } : {}),
    }),
    [color, icon, key, path, projectId, projectName, shared, title],
  );

  const data = useMemo<NotesData>(
    () => ({
      ...library,
      ...files,
      ...(shared ? { notes: NO_NOTES, noteLinks: undefined } : {}),
      citations,
      projectCitations: undefined,
      importNotebook: undefined,
      renameNote: rename,
      deleteNote: undefined,
      setRelatedProject: undefined,
      copyArtifact: undefined,
      previewArtifact: undefined,
    }),
    [citations, files, library, rename, shared],
  );

  return (
    <NotesDataProvider value={data}>
      <div ref={appearanceRef} data-testid="project-note-tab" className="flex min-h-0 flex-1 flex-col">
        <NoteTabBar
          icon={
            shared ? (
              <Users aria-hidden className="size-3.5 shrink-0" />
            ) : (
              <NotebookPen aria-hidden className="size-3.5 shrink-0" />
            )
          }
          label={t(($) => $.notes.noteTab.projectNote)}
          detail={shared ? t(($) => $.notes.noteTab.sharedProject) : t(($) => $.notes.noteTab.localProject)}
          noticeId={key}
          save={save}
        >
          <NoteTabButton
            testId="note-tab-markdown"
            label={t(($) => $.editor.shell.editAsMarkdown)}
            icon={<FileCode aria-hidden className="size-3.5" />}
            onClick={() => useNoteTabsStore.getState().setMarkdown(projectId, path, true)}
          />
          <NoteTabButton
            testId="note-tab-copy"
            label={t(($) => $.notes.noteTab.copyToMine)}
            icon={copying ? <Spinner size="sm" /> : <Copy aria-hidden className="size-3.5" />}
            disabled={copying}
            onClick={() => copy(() => copyProjectNoteToMine(projectId, path))}
          />
        </NoteTabBar>
        <TabDocument
          note={note}
          insertRequest={null}
          live={live}
          shown={shown}
          onOpenNote={openLinked}
          onStatusChange={report}
        />
      </div>
    </NotesDataProvider>
  );
}

export function PersonalNoteTab({ projectId, noteId, shown = true }: Readonly<{ projectId: string; noteId: string; shown?: boolean }>) {
  const { t } = useTranslation(["notes"]);
  const { data, headsLoaded } = useLibraryNotesData();
  const note = data.notes.find((entry) => entry.id === noteId) ?? null;
  const projectsLoaded = useFilesStore((state) => state.projectsLoaded);
  const icon = note?.icon;
  const color = note?.color;
  const [save, report] = useSaveState();
  const [moving, move] = useBusy();
  const appearanceRef = useNotesAppearanceRef<HTMLDivElement>();
  const openLinked = useOpenLinked(projectId);
  const openHeading = useOpenHeading(noteId);

  useEffect(() => {
    if (headsLoaded) useNoteTabsStore.getState().setLook(noteId, { icon, color });
  }, [color, headsLoaded, icon, noteId]);

  if (!note) {
    if (!projectsLoaded || !headsLoaded) {
      return (
        <div className="flex flex-1 items-center justify-center">
          <Spinner size="sm" />
        </div>
      );
    }
    return (
      <p data-testid="personal-note-missing" className="flex-1 p-8 text-sm text-muted-foreground">
        {t(($) => $.notes.noteTab.missing)}
      </p>
    );
  }

  return (
    <NotesDataProvider value={data}>
      <div ref={appearanceRef} data-testid="personal-note-tab" className="flex min-h-0 flex-1 flex-col">
        <NoteTabBar
          icon={<Lock aria-hidden className="size-3.5 shrink-0" />}
          label={t(($) => $.notes.noteTab.personalNote)}
          detail={note.shared ? t(($) => $.notes.noteTab.personalShared) : t(($) => $.notes.noteTab.private)}
          noticeId={noteId}
          save={save}
        >
          <NoteTabButton
            testId="note-tab-move"
            label={t(($) => $.notes.noteTab.moveIntoProject)}
            icon={moving ? <Spinner size="sm" /> : <FolderInput aria-hidden className="size-3.5" />}
            disabled={moving}
            onClick={() => move(() => moveNoteIntoProject(noteId, projectId))}
          />
          <NoteTabButton
            testId="note-tab-open-in-notes"
            label={t(($) => $.notes.noteTab.openInNotes)}
            icon={<NotebookPen aria-hidden className="size-3.5" />}
            onClick={() => void openNotes(noteId)}
          />
        </NoteTabBar>
        <TabDocument
          note={note}
          insertRequest={null}
          openHeading={openHeading}
          shown={shown}
          onOpenNote={openLinked}
          onStatusChange={report}
        />
      </div>
    </NotesDataProvider>
  );
}
