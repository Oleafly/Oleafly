import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { getEditorDocumentPath, getEditorView, subscribeEditorDocument } from "@oleafly/editor";
import {
  useCommentsRail,
  showCommentsTab,
  openCommentThread,
  type CommentRequest,
} from "@/components/collab/comments-rail";
import { setCommentsEditorExtension } from "@/components/editor/cm/comments-slot";
import { registerPersonalCommentsFlush } from "@/lib/personal-comments-flush";
import { registerProjectLeaveGuard } from "@/lib/project-leave-guards";
import { onPathsDeleted, onPathsMoved, useFilesStore } from "@/store/files";
import { logError } from "@/lib/log";
import {
  commentDraftIn,
  editorComments,
  revealComment,
  type CommentSpan,
} from "@/features/collab/comments/editor-comments";
import {
  mergeComments,
  parseComments,
  remapFile,
  type PersonalComments,
  type PersonalComment,
} from "./model";

interface PersonalCommentsState {
  projectId: string | null;
  phase: "loading" | "ready" | "failed";
  data: PersonalComments;
  path: string | null;
  selected: string | null;
  draft: CommentRequest | null;
  showResolved: boolean;
  saveError: boolean;
  conflict: boolean;
}

const empty = (): PersonalComments => ({ version: 1, files: [] });
export const usePersonalComments = create<PersonalCommentsState>(() => ({
  projectId: null,
  phase: "loading",
  data: empty(),
  path: null,
  selected: null,
  draft: null,
  showResolved: false,
  saveError: false,
  conflict: false,
}));

interface Session {
  projectId: string;
  data: PersonalComments;
  base: PersonalComments;
  revision: number;
  dirty: boolean;
  saving: Promise<void> | null;
  timer: ReturnType<typeof setTimeout> | null;
}
let current: Session | null = null;
let loadToken = 0;

function publish(session: Session): void {
  if (current === session) usePersonalComments.setState({ data: session.data });
}

export async function flushNotes(): Promise<void> {
  const session = current;
  if (!session) return;
  if (session.timer) clearTimeout(session.timer);
  session.timer = null;
  if (session.saving) return session.saving;
  if (!session.dirty) return;
  session.saving = (async () => {
    try {
      let conflicts = 0;
      while (session.dirty) {
        const data = session.data;
        try {
          session.revision = await invoke<number>("personal_comments_save", {
            projectId: session.projectId,
            revision: session.revision,
            data,
          });
        } catch (error) {
          if (!String(error).includes("personal_comments_conflict") || ++conflicts > 3) throw error;
          const saved = await invoke<{ revision: number; data: unknown }>("personal_comments_load", {
            projectId: session.projectId,
          });
          const remote = parseComments(saved.data);
          session.data = mergeComments(session.base, session.data, remote);
          session.base = remote;
          session.revision = saved.revision;
          publish(session);
          continue;
        }
        session.base = data;
        session.dirty = session.data !== data;
      }
      if (current === session) usePersonalComments.setState({ saveError: false, conflict: false });
    } catch (error) {
      if (current === session)
        usePersonalComments.setState({
          saveError: true,
          conflict: String(error).includes("personal_comments_conflict"),
        });
      throw error;
    } finally {
      session.saving = null;
    }
  })();
  return session.saving;
}

function saveSoon(session: Session): void {
  session.dirty = true;
  if (session.timer) clearTimeout(session.timer);
  session.timer = setTimeout(() => {
    session.timer = null;
    void flushNotes().catch((error: unknown) => logError("save personal comments", error));
  }, 400);
}

function replaceData(data: PersonalComments): void {
  const session = current;
  if (!session || usePersonalComments.getState().phase !== "ready") return;
  session.data = data;
  publish(session);
  saveSoon(session);
}

function syncFiles(): void {
  const files = useFilesStore.getState();
  const state = usePersonalComments.getState();
  if (!current || current.projectId !== files.projectId) return;
  let changed = false;
  const mapped = current.data.files.map((file) => {
    const text = files.files[file.path]?.content;
    const next = text === undefined ? file : remapFile(file, text);
    changed ||= next !== file;
    return next;
  });
  if (changed) replaceData({ version: 1, files: mapped });
  if (state.path !== files.activePath)
    usePersonalComments.setState({
      path: files.activePath,
      selected: null,
      draft: null,
    });
}

export async function loadNotes(): Promise<void> {
  const projectId = useFilesStore.getState().projectId;
  const token = ++loadToken;
  current = null;
  usePersonalComments.setState({
    projectId,
    phase: "loading",
    data: empty(),
    path: useFilesStore.getState().activePath,
    draft: null,
    selected: null,
    saveError: false,
    conflict: false,
  });
  if (!projectId) return;
  try {
    const saved = await invoke<{ revision: number; data: unknown }>("personal_comments_load", { projectId });
    const data = parseComments(saved.data);
    if (token !== loadToken) return;
    current = {
      projectId,
      data,
      base: data,
      revision: saved.revision,
      dirty: false,
      saving: null,
      timer: null,
    };
    usePersonalComments.setState({ data, phase: "ready" });
    syncFiles();
  } catch (error) {
    if (token !== loadToken) return;
    usePersonalComments.setState({ phase: "failed" });
    void logError("load personal comments", error);
  }
}

export function cancelPersonalDraft(): void {
  usePersonalComments.setState({ draft: null });
  getEditorView()?.focus();
}

export async function createPersonalComment(body: string): Promise<void> {
  const state = usePersonalComments.getState();
  const draft = state.draft;
  const view = getEditorView();
  if (!current || !draft || !view || getEditorDocumentPath() !== draft.path || !body.trim()) {
    throw { code: "comment_selection_changed", message: "Select the text again" };
  }
  syncFiles();
  const range = commentDraftIn(view.state) ?? draft;
  if (range.from >= range.to)
    throw { code: "comment_selection_changed", message: "The selected text was deleted" };
  const text = view.state.doc.toString();
  const note: PersonalComment = {
    id: crypto.randomUUID(),
    body: body.trim(),
    quote: text.slice(range.from, range.to),
    range: { from: range.from, to: range.to },
    resolved: false,
  };
  const data = current.data;
  const file = data.files.find((entry) => entry.path === draft.path);
  const mapped = file ? remapFile(file, text) : null;
  replaceData({
    version: 1,
    files: mapped
      ? data.files.map((entry) => (entry === file ? { ...mapped, notes: [...mapped.notes, note] } : entry))
      : [...data.files, { path: draft.path, text, notes: [note] }],
  });
  usePersonalComments.setState({ draft: null, selected: note.id });
  getEditorView()?.focus();
  // The note stays visible in memory on failure; the pane offers a retry.
  await flushNotes().catch(() => undefined);
}

export async function changePersonalComment(
  id: string,
  change: Partial<Pick<PersonalComment, "body" | "resolved">> | null,
): Promise<void> {
  if (!current) return;
  replaceData({
    version: 1,
    files: current.data.files
      .map((file) => ({
        ...file,
        notes: file.notes.flatMap((note) =>
          note.id !== id ? [note] : change ? [{ ...note, ...change }] : [],
        ),
      }))
      .filter((file) => file.notes.length > 0),
  });
  await flushNotes().catch(() => undefined);
}

export function selectPersonalComment(path: string, id: string): void {
  usePersonalComments.setState({ selected: id });
  openCommentThread(path, id);
}

const spansCache = new WeakMap<PersonalComment[], readonly CommentSpan[]>();
function spans(notes: PersonalComment[]): readonly CommentSpan[] {
  let found = spansCache.get(notes);
  if (!found) {
    found = notes.flatMap((note) =>
      note.range ? [{ ...note.range, id: note.id, resolved: note.resolved }] : [],
    );
    spansCache.set(notes, found);
  }
  return found;
}
const NO_SPANS: readonly CommentSpan[] = [];

export function startPersonalComments(): () => void {
  const syncRail = () => {
    const state = usePersonalComments.getState();
    useCommentsRail.setState({ visible: state.projectId !== null, canCompose: state.phase === "ready" });
  };
  const reveal = () => {
    const target = useCommentsRail.getState().reveal;
    const view = getEditorView();
    if (!target || !view || getEditorDocumentPath() !== target.path) return;
    usePersonalComments.setState({ selected: target.threadId });
    // The comment extension pushes its spans in a microtask on file changes.
    queueMicrotask(() => {
      if (revealComment(view, target.threadId)) useCommentsRail.setState({ reveal: null });
    });
  };
  const release = setCommentsEditorExtension(
    editorComments({
      snapshot: () => {
        const state = usePersonalComments.getState();
        const file = state.data.files.find((entry) => entry.path === state.path);
        return {
          path: state.path,
          spans: file ? spans(file.notes) : NO_SPANS,
          selected: state.selected,
          draft: state.draft,
        };
      },
      documentPath: getEditorDocumentPath,
      subscribe: (listener) => {
        const stopState = usePersonalComments.subscribe(listener);
        const stopDoc = subscribeEditorDocument(listener);
        return () => {
          stopState();
          stopDoc();
        };
      },
      open: (id) => {
        usePersonalComments.setState({ selected: id });
        showCommentsTab();
      },
    }),
  );
  const stopState = usePersonalComments.subscribe(syncRail);
  const stopFiles = useFilesStore.subscribe((files, previous) => {
    if (files.projectId !== previous.projectId) void loadNotes();
    else if (files.files !== previous.files || files.activePath !== previous.activePath) syncFiles();
  });
  const stopRail = useCommentsRail.subscribe((rail, previous) => {
    if (rail.request && rail.request !== previous.request && rail.canCompose) {
      const draft = rail.request;
      useCommentsRail.setState({ request: null });
      usePersonalComments.setState({ draft, selected: null });
    }
    if (rail.reveal !== previous.reveal) reveal();
  });
  const stopDocument = subscribeEditorDocument(reveal);
  const stopMoved = onPathsMoved(({ projectId, from, to }) => {
    if (!current || current.projectId !== projectId) return;
    const moved = new Map<string, PersonalComments["files"][number]>();
    for (const file of current.data.files) {
      const path =
        file.path === from
          ? to
          : file.path.startsWith(`${from}/`)
            ? to + file.path.slice(from.length)
            : file.path;
      const text = useFilesStore.getState().files[path]?.content ?? file.text;
      const mapped = remapFile(file, text);
      const existing = moved.get(path);
      moved.set(path, { ...mapped, path, notes: [...(existing?.notes ?? []), ...mapped.notes] });
    }
    replaceData({ version: 1, files: [...moved.values()] });
  });
  const stopDeleted = onPathsDeleted(({ projectId, path }) => {
    if (!current || current.projectId !== projectId) return;
    replaceData({
      version: 1,
      files: current.data.files.map((file) =>
        file.path === path || file.path.startsWith(`${path}/`)
          ? { ...file, notes: file.notes.map((note) => ({ ...note, range: null })) }
          : file,
      ),
    });
  });
  const stopFlush = registerPersonalCommentsFlush(flushNotes);
  const stopLeave = registerProjectLeaveGuard(async () => {
    try {
      await flushNotes();
      return true;
    } catch {
      showCommentsTab();
      return false;
    }
  });
  void loadNotes();
  return () => {
    stopState();
    stopFiles();
    stopRail();
    stopDocument();
    stopMoved();
    stopDeleted();
    stopFlush();
    stopLeave();
    release();
    // Captured session writes finish independently of the next project.
    void flushNotes().catch((error: unknown) => logError("save personal comments on close", error));
    if (current?.timer) clearTimeout(current.timer);
    current = null;
    loadToken += 1;
    useCommentsRail.setState({ visible: false, canCompose: false, request: null, reveal: null });
  };
}
