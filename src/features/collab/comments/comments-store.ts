import { create } from "zustand";
import { getEditorDocumentPath, getEditorView, subscribeEditorDocument } from "@oleafly/editor";
import {
  openCommentThread,
  showCommentsTab,
  useCommentsRail,
  type CommentRequest,
} from "@/components/collab/comments-rail";
import { setCommentsEditorExtension } from "@/components/editor/cm/comments-slot";
import { collabDocumentSession } from "@/lib/collab-live-bridge";
import { logError } from "@/lib/log";
import {
  collabCommentCounts,
  collabCommentCreate,
  collabCommentDelete,
  collabCommentEdit,
  collabCommentReopen,
  collabCommentReply,
  collabCommentResolve,
  collabCommentsStatus,
  collabCommentThreadDelete,
  collabCommentThreadList,
  isCollabCommentError,
  onCollabCommentsChanged,
  onCollabCommentsStatus,
  type CollabCommentCount,
  type CollabCommentMember,
  type CollabCommentMessage,
  type CollabCommentsChanged,
  type CollabCommentsStatus,
  type CollabCommentThread,
  type CollabErrorCode,
  type CollabLiveState,
  type CollabProjectMember,
} from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { collabErrorCode } from "../errors";
import { useCollabLiveStore } from "../live/live-store";
import { useCollabActivity } from "../sharing/activity-store";
import {
  commentDraftIn,
  editorComments,
  revealComment,
  type CommentDraftRange,
  type CommentOpenedFrom,
  type AnchorChange,
  type CommentSpan,
  type EditorCommentsSource,
} from "./editor-comments";

export type CommentsPhase = "idle" | "loading" | "ready" | "failed";

export interface FileThreads {
  phase: CommentsPhase;
  threads: CollabCommentThread[];
  error: CollabErrorCode | null;
}

export interface CommentsState {
  projectId: string | null;
  status: CollabCommentsStatus | null;
  path: string | null;
  threads: CollabCommentThread[];
  phase: CommentsPhase;
  error: CollabErrorCode | null;
  selectedId: string | null;
  focus: number;
  showResolved: boolean;
  draft: CommentRequest | null;
  emptied: readonly string[];
  counts: readonly CollabCommentCount[] | null;
  elsewhere: Readonly<Record<string, FileThreads>>;
}

const RELOAD_DELAY_MS = 150;
const SETTLE_LIMIT_MS = 1_500;
const RETRY_REVEAL_MS = 120;
const LIST_ATTEMPTS = 5;
const CREATE_ATTEMPTS = 3;
const CATCH_UP_MS = 250;
const ANCHOR_RELOAD_MS = 800;

function blank(projectId: string | null): Omit<CommentsState, "showResolved" | "focus"> {
  return {
    projectId,
    status: null,
    path: null,
    threads: [],
    phase: "idle",
    error: null,
    selectedId: null,
    draft: null,
    emptied: [],
    counts: null,
    elsewhere: {},
  };
}

export const useComments = create<CommentsState>(() => ({ ...blank(null), focus: 0, showResolved: false }));

export function commentsShown(status: CollabCommentsStatus | null): boolean {
  return status?.serverAllowed === true && status.projectEnabled;
}

export function commentSelf(): string | null {
  return useCollabLiveStore.getState().share?.account_id ?? null;
}

export function canWriteComments(
  status: CollabCommentsStatus | null,
  role: string | null,
  live: CollabLiveState["state"] | null,
): boolean {
  return commentsShown(status) && status?.canComment === true && role !== "viewer" && live !== null && live !== "ended";
}

export function commentMember(member: CollabProjectMember): CollabCommentMember {
  return { accountId: member.person.account_id, displayName: member.person.display_name, login: member.person.login };
}

export function commentMembers(): CollabCommentMember[] {
  return useCollabLiveStore.getState().members.map(commentMember);
}

export function byDocument(threads: readonly CollabCommentThread[]): CollabCommentThread[] {
  return [...threads].sort((left, right) => {
    const a = left.anchor.range;
    const b = right.anchor.range;
    if (a && b) return a.from - b.from || a.to - b.to || left.createdAt - right.createdAt;
    if (a) return -1;
    if (b) return 1;
    return left.createdAt - right.createdAt;
  });
}

const spanCache = new WeakMap<CollabCommentThread[], readonly CommentSpan[]>();
const draftCache = new WeakMap<CommentRequest, CommentDraftRange>();

function spansOf(threads: CollabCommentThread[]): readonly CommentSpan[] {
  const cached = spanCache.get(threads);
  if (cached) return cached;
  const spans = threads.flatMap((thread) =>
    thread.anchor.range
      ? [{ id: thread.id, from: thread.anchor.range.from, to: thread.anchor.range.to, resolved: thread.resolved !== null }]
      : [],
  );
  spanCache.set(threads, spans);
  return spans;
}

function draftRangeOf(draft: CommentRequest): CommentDraftRange {
  const cached = draftCache.get(draft);
  if (cached) return cached;
  const range = { from: draft.from, to: draft.to };
  draftCache.set(draft, range);
  return range;
}

interface Settles {
  settled(): Promise<void>;
}

function settles(session: unknown): session is Settles {
  return typeof (session as Partial<Settles> | null)?.settled === "function";
}

interface Revisioned extends Settles {
  readonly phase: string;
  readonly synchronized: boolean;
  readonly revision: number;
  subscribe(listener: () => void): () => void;
}

function revisioned(session: unknown): session is Revisioned {
  const candidate = session as Partial<Revisioned> | null;
  return (
    settles(session) &&
    typeof candidate?.revision === "number" &&
    typeof candidate.synchronized === "boolean" &&
    typeof candidate.subscribe === "function"
  );
}

function openSession(path: string): Revisioned | null {
  const session = collabDocumentSession(path);
  return revisioned(session) && session.phase === "open" ? session : null;
}

type Freshness = "current" | "behind" | "stale";

function freshness(session: Revisioned | null, rev: number | null): Freshness {
  if (!session) return "current";
  if (!session.synchronized || rev === null || rev < session.revision) return "stale";
  return rev === session.revision ? "current" : "behind";
}

async function catchUp(path: string, session: Revisioned, verdict: Freshness): Promise<void> {
  await settled(path);
  if (verdict !== "behind") return;
  await new Promise<void>((resolve) => {
    let stop: () => void = () => undefined;
    const done = () => {
      clearTimeout(timer);
      stop();
      resolve();
    };
    const timer = setTimeout(done, CATCH_UP_MS);
    stop = session.subscribe(done);
  });
}

async function settled(path: string): Promise<void> {
  const session = collabDocumentSession(path);
  if (!settles(session)) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      session.settled(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SETTLE_LIMIT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function tabOpen(): boolean {
  const settings = useSettingsStore.getState();
  return settings.railTab === "comments" && settings.showTree;
}

function noteUnseen(): void {
  if (!tabOpen() && !useCommentsRail.getState().unread) useCommentsRail.setState({ unread: true });
}

function revealInEditor(id: string): boolean {
  const view = getEditorView();
  const { path } = useComments.getState();
  if (!view || !path || getEditorDocumentPath() !== path) return false;
  return revealComment(view, id);
}

export function selectThread(id: string | null, options: { reveal?: boolean; focus?: boolean } = {}): void {
  useComments.setState((state) => ({ selectedId: id, focus: options.focus ? state.focus + 1 : state.focus }));
  if (!id || !options.reveal) return;
  queueMicrotask(() => {
    if (!revealInEditor(id)) setTimeout(() => revealInEditor(id), RETRY_REVEAL_MS);
  });
}

export function openCommentFromEditor(id: string, from: CommentOpenedFrom): void {
  selectThread(id, { focus: true });
  if (from === "marker") {
    showCommentsTab();
    return;
  }
  const settings = useSettingsStore.getState();
  if (settings.showTree && settings.railTab !== "comments") settings.setRailTab("comments");
}

function applyReveal(): void {
  const reveal = useCommentsRail.getState().reveal;
  const state = useComments.getState();
  if (!reveal || state.path !== reveal.path || state.phase !== "ready") return;
  useCommentsRail.setState({ reveal: null });
  if (state.threads.some((thread) => thread.id === reveal.threadId)) {
    selectThread(reveal.threadId, { reveal: true, focus: true });
  }
}

let loadToken = 0;

function sameData(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return (
    keys.length === Object.keys(rightRecord).length &&
    keys.every((key) => Object.hasOwn(rightRecord, key) && sameData(leftRecord[key], rightRecord[key]))
  );
}

function keepUnchanged(previous: CollabCommentThread[], next: CollabCommentThread[]): CollabCommentThread[] {
  const known = new Map(previous.map((thread) => [thread.id, thread]));
  const kept = next.map((thread) => {
    const old = known.get(thread.id);
    return old && sameData(old, thread) ? old : thread;
  });
  const same = kept.length === previous.length && kept.every((thread, index) => thread === previous[index]);
  return same ? previous : kept;
}

function without(
  elsewhere: Readonly<Record<string, FileThreads>>,
  path: string,
): Readonly<Record<string, FileThreads>> {
  if (!Object.hasOwn(elsewhere, path)) return elsewhere;
  return Object.fromEntries(Object.entries(elsewhere).filter(([key]) => key !== path));
}

let countToken = 0;

async function refreshCounts(): Promise<void> {
  const projectId = useComments.getState().projectId;
  const token = ++countToken;
  if (!projectId) return;
  let counts: CollabCommentCount[];
  try {
    counts = await collabCommentCounts(projectId);
  } catch (error) {
    if (token !== countToken) return;
    if (collabErrorCode(error) !== "not_found") void logError("collab comment counts", error);
    useComments.setState((state) => (state.counts === null ? { counts: [] } : state));
    return;
  }
  if (token !== countToken || useComments.getState().projectId !== projectId) return;
  useComments.setState((state) => {
    const listed = new Set(counts.map((count) => count.path));
    const kept = Object.entries(state.elsewhere).filter(([path]) => listed.has(path));
    const same = sameData(state.counts, counts);
    const trimmed = kept.length !== Object.keys(state.elsewhere).length;
    if (same && !trimmed) return state;
    return {
      counts: same ? state.counts : counts,
      elsewhere: trimmed ? Object.fromEntries(kept) : state.elsewhere,
    };
  });
}

const elsewhereTokens = new Map<string, number>();
let elsewhereToken = 0;

function setElsewhere(path: string, change: (entry: FileThreads) => FileThreads): void {
  useComments.setState((state) => {
    const entry = state.elsewhere[path];
    if (!entry) return state;
    const next = change(entry);
    if (next.phase === entry.phase && next.error === entry.error && next.threads === entry.threads) return state;
    return { elsewhere: { ...state.elsewhere, [path]: next } };
  });
}

async function loadElsewhere(path: string): Promise<void> {
  const projectId = useComments.getState().projectId;
  if (!projectId) return;
  const token = ++elsewhereToken;
  elsewhereTokens.set(path, token);
  const stale = () => elsewhereTokens.get(path) !== token || useComments.getState().projectId !== projectId;
  try {
    const listed = await collabCommentThreadList(projectId, path);
    if (stale()) return;
    setElsewhere(path, (entry) => ({
      phase: "ready",
      error: null,
      threads: keepUnchanged(entry.threads, byDocument(listed.threads)),
    }));
  } catch (error) {
    if (stale()) return;
    const code = collabErrorCode(error);
    if (code !== "not_found") void logError("collab comments load", error);
    setElsewhere(path, (entry) =>
      code === "not_found" ? { phase: "ready", error: null, threads: [] } : { ...entry, phase: "failed", error: code },
    );
  }
}

export function expandFile(path: string): void {
  useComments.setState((state) => {
    const entry = state.elsewhere[path];
    if (entry && entry.phase !== "failed") return state;
    return { elsewhere: { ...state.elsewhere, [path]: { phase: "loading", threads: entry?.threads ?? [], error: null } } };
  });
  void loadElsewhere(path);
}

export function collapseFile(path: string): void {
  useComments.setState((state) => {
    const elsewhere = without(state.elsewhere, path);
    return elsewhere === state.elsewhere ? state : { elsewhere };
  });
}

export function openThreadIn(path: string, id: string): void {
  if (path === useComments.getState().path) {
    selectThread(id, { reveal: true });
    return;
  }
  openCommentThread(path, id);
}

async function currentList(projectId: string, path: string, token: number): Promise<CollabCommentThread[] | null> {
  for (let attempt = 1; ; attempt += 1) {
    const listed = await collabCommentThreadList(projectId, path);
    if (token !== loadToken) return null;
    const session = openSession(path);
    const verdict = freshness(session, listed.rev);
    if (!session || verdict === "current" || attempt >= LIST_ATTEMPTS) return listed.threads;
    await catchUp(path, session, verdict);
    if (token !== loadToken) return null;
  }
}

async function load(path: string | null): Promise<CollabCommentThread[] | null> {
  const projectId = useComments.getState().projectId;
  const token = ++loadToken;
  if (!projectId || !path) {
    useComments.setState({ path, threads: [], phase: "idle", error: null, selectedId: null, emptied: [] });
    return null;
  }
  if (useComments.getState().path === path) {
    if (useComments.getState().phase !== "ready") useComments.setState({ phase: "loading", error: null });
  } else {
    useComments.setState((state) => ({
      path,
      threads: [],
      phase: "loading",
      error: null,
      selectedId: null,
      emptied: [],
      elsewhere: without(state.elsewhere, path),
    }));
  }
  let listed: CollabCommentThread[] | null;
  try {
    listed = await currentList(projectId, path, token);
  } catch (error) {
    if (token !== loadToken) return null;
    const code = collabErrorCode(error);
    if (code === "not_found") {
      useComments.setState({ threads: [], phase: "ready", error: null, selectedId: null });
      applyReveal();
      return [];
    }
    void logError("collab comments load", error);
    useComments.setState({ phase: "failed", error: code });
    return null;
  }
  if (token !== loadToken || listed === null) return null;
  const threads = keepUnchanged(useComments.getState().threads, byDocument(listed));
  useComments.setState((state) => ({
    threads,
    phase: "ready",
    error: null,
    selectedId: threads.some((thread) => thread.id === state.selectedId) ? state.selectedId : null,
  }));
  applyReveal();
  return threads;
}

function othersWrote(before: readonly CollabCommentThread[], after: readonly CollabCommentThread[], self: string | null) {
  const messages = new Map<string, CollabCommentMessage>();
  for (const thread of before) for (const message of thread.messages) messages.set(message.id, message);
  const resolved = new Map(before.map((thread) => [thread.id, thread.resolved !== null]));
  return after.some((thread) => {
    const resolvedByOther = thread.resolved && (thread.resolved.by !== self || !thread.resolved.verified);
    if (resolvedByOther && !resolved.get(thread.id)) return true;
    return thread.messages.some((message) => {
      if (message.author === self && message.verified) return false;
      const old = messages.get(message.id);
      return old?.editedAt !== message.editedAt || old.deleted !== message.deleted;
    });
  });
}

function currentPath(): string | null {
  const files = useFilesStore.getState();
  return files.projectId !== null && files.projectId === useComments.getState().projectId ? files.activePath : null;
}

export function reloadThreads(): void {
  void load(currentPath());
}

export function cancelDraft(): void {
  useComments.setState({ draft: null });
}

export function setShowResolved(showResolved: boolean): void {
  useComments.setState((state) => {
    const selected = state.threads.find((thread) => thread.id === state.selectedId);
    const hidden = !showResolved && selected?.resolved;
    return { showResolved, selectedId: hidden ? null : state.selectedId };
  });
}

function requireProject(): string {
  const projectId = useComments.getState().projectId;
  if (!projectId) throw new Error("This project is not shared.");
  return projectId;
}

function patched(
  threads: CollabCommentThread[],
  id: string,
  change: (thread: CollabCommentThread) => CollabCommentThread | null,
): CollabCommentThread[] {
  return byDocument(
    threads.flatMap((thread) => {
      if (thread.id !== id) return [thread];
      const next = change(thread);
      return next ? [next] : [];
    }),
  );
}

function patchThread(id: string, change: (thread: CollabCommentThread) => CollabCommentThread | null): void {
  useComments.setState((state) => {
    const holds = (threads: readonly CollabCommentThread[]) => threads.some((thread) => thread.id === id);
    const here = holds(state.threads);
    const touched = Object.entries(state.elsewhere).filter(([, entry]) => holds(entry.threads));
    if (!here && touched.length === 0) return state;
    const next: Partial<CommentsState> = {};
    if (here) {
      const threads = patched(state.threads, id, change);
      next.threads = threads;
      next.selectedId = threads.some((thread) => thread.id === state.selectedId) ? state.selectedId : null;
    }
    if (touched.length > 0) {
      next.elsewhere = {
        ...state.elsewhere,
        ...Object.fromEntries(
          touched.map(([path, entry]) => [path, { ...entry, threads: patched(entry.threads, id, change) }]),
        ),
      };
    }
    return next;
  });
}

function withMessage(thread: CollabCommentThread, message: CollabCommentMessage): CollabCommentThread {
  const exists = thread.messages.some((entry) => entry.id === message.id);
  return {
    ...thread,
    messages: exists
      ? thread.messages.map((entry) => (entry.id === message.id ? message : entry))
      : [...thread.messages, message],
  };
}

function draftRangeInEditor(draft: CommentRequest): CommentDraftRange {
  const view = getEditorView();
  if (!view || getEditorDocumentPath() !== draft.path) return draft;
  return commentDraftIn(view.state) ?? draft;
}

function selectionMoved(error: unknown): boolean {
  return isCollabCommentError(error) && error.code === "comment_selection_changed";
}

async function createAtEditor(
  projectId: string,
  draft: CommentRequest,
  body: string,
  attempt = 1,
): Promise<CollabCommentThread> {
  await settled(draft.path);
  const range = draftRangeInEditor(draft);
  const session = openSession(draft.path);
  const rev = session?.synchronized ? session.revision : null;
  try {
    return await collabCommentCreate(projectId, draft.path, range.from, range.to, rev, body, commentMembers());
  } catch (error) {
    if (!session || !selectionMoved(error) || attempt >= CREATE_ATTEMPTS) throw error;
    await catchUp(draft.path, session, "behind");
  }
  return createAtEditor(projectId, draft, body, attempt + 1);
}

export async function createThread(body: string): Promise<void> {
  const projectId = requireProject();
  const draft = useComments.getState().draft;
  if (!draft) return;
  const thread = await createAtEditor(projectId, draft, body);
  useComments.setState((state) => ({
    draft: state.draft === draft ? null : state.draft,
    selectedId: thread.id,
    threads:
      state.path === draft.path
        ? byDocument([...state.threads.filter((entry) => entry.id !== thread.id), thread])
        : state.threads,
  }));
}

export async function replyToThread(thread: CollabCommentThread, body: string): Promise<void> {
  const message = await collabCommentReply(requireProject(), thread.fileId, thread.id, body, commentMembers());
  patchThread(thread.id, (current) => withMessage(current, message));
}

export async function editMessage(thread: CollabCommentThread, messageId: string, body: string): Promise<void> {
  const message = await collabCommentEdit(requireProject(), thread.fileId, thread.id, messageId, body, commentMembers());
  patchThread(thread.id, (current) => withMessage(current, message));
}

export async function deleteMessage(thread: CollabCommentThread, messageId: string): Promise<void> {
  await collabCommentDelete(requireProject(), thread.fileId, thread.id, messageId);
  patchThread(thread.id, (current) => ({
    ...current,
    messages: current.messages.map((entry) => (entry.id === messageId ? { ...entry, body: "", deleted: true } : entry)),
  }));
}

export async function resolveThread(thread: CollabCommentThread): Promise<void> {
  const next = await collabCommentResolve(requireProject(), thread.fileId, thread.id);
  patchThread(thread.id, () => next);
}

export async function reopenThread(thread: CollabCommentThread): Promise<void> {
  const next = await collabCommentReopen(requireProject(), thread.fileId, thread.id);
  patchThread(thread.id, () => next);
}

export async function deleteThread(thread: CollabCommentThread): Promise<void> {
  await collabCommentThreadDelete(requireProject(), thread.fileId, thread.id);
  patchThread(thread.id, () => null);
}

function memberName(accountId: string): string {
  return (
    useCollabLiveStore.getState().members.find((member) => member.person.account_id === accountId)?.person
      .display_name ?? ""
  );
}

function noteMentions(payload: CollabCommentsChanged): void {
  for (const mention of payload.mentioned) {
    const known = useCollabActivity
      .getState()
      .entries.some((entry) => entry.kind === "mentioned" && entry.messageId === mention.messageId);
    if (known) continue;
    useCollabActivity.getState().add({
      kind: "mentioned",
      at: Date.now(),
      accountId: mention.author,
      name: memberName(mention.author),
      path: mention.path,
      threadId: mention.threadId,
      messageId: mention.messageId,
    });
  }
}

let anchorListener: ((change: AnchorChange) => void) | null = null;

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

const source: EditorCommentsSource = {
  snapshot: () => {
    const state = useComments.getState();
    return {
      path: state.path,
      spans: spansOf(state.threads),
      selected: state.selectedId,
      draft: state.draft && state.draft.path === state.path ? draftRangeOf(state.draft) : null,
    };
  },
  documentPath: getEditorDocumentPath,
  subscribe: (listener) => {
    const stopStore = useComments.subscribe(() => listener());
    const stopDocument = subscribeEditorDocument(() => listener());
    return () => {
      stopStore();
      stopDocument();
    };
  },
  open: openCommentFromEditor,
  anchorsChanged: (change) => anchorListener?.(change),
};

export function startComments(): () => void {
  let release: (() => void) | null = null;
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  let anchorTimer: ReturnType<typeof setTimeout> | null = null;
  let elsewhereTimer: ReturnType<typeof setTimeout> | null = null;
  let touched = new Set<string>();
  let statusToken = 0;

  const install = () => {
    release ??= setCommentsEditorExtension(editorComments(source));
  };
  const uninstall = () => {
    release?.();
    release = null;
  };
  const cancelReload = () => {
    if (reloadTimer !== null) clearTimeout(reloadTimer);
    reloadTimer = null;
    if (anchorTimer !== null) clearTimeout(anchorTimer);
    anchorTimer = null;
  };
  const forgetElsewhere = () => {
    if (elsewhereTimer !== null) clearTimeout(elsewhereTimer);
    elsewhereTimer = null;
    touched = new Set();
    countToken += 1;
    elsewhereTokens.clear();
  };

  const syncRail = () => {
    const state = useComments.getState();
    const visible = commentsShown(state.status);
    const live = useCollabLiveStore.getState();
    const canCompose = canWriteComments(state.status, live.role, live.status?.state ?? null);
    const rail = useCommentsRail.getState();
    if (rail.visible === visible && rail.canCompose === canCompose) return;
    useCommentsRail.setState(visible ? { visible, canCompose } : { visible, canCompose, unread: false, request: null });
  };

  const applyStatus = (status: CollabCommentsStatus) => {
    const wasShown = commentsShown(useComments.getState().status);
    useComments.setState({ status });
    const shown = commentsShown(status);
    if (shown && !wasShown) {
      install();
      void load(currentPath());
      void refreshCounts();
    } else if (!shown && wasShown) {
      uninstall();
      cancelReload();
      forgetElsewhere();
      loadToken += 1;
      useComments.setState({
        path: null,
        threads: [],
        phase: "idle",
        error: null,
        selectedId: null,
        draft: null,
        emptied: [],
        counts: null,
        elsewhere: {},
      });
    }
    syncRail();
  };

  const refreshStatus = async () => {
    const projectId = useComments.getState().projectId;
    if (!projectId) return;
    const token = ++statusToken;
    try {
      const status = await collabCommentsStatus(projectId);
      if (token === statusToken && useComments.getState().projectId === projectId) applyStatus(status);
    } catch (error) {
      void logError("collab comments status", error);
    }
  };

  const openProject = () => {
    const live = useCollabLiveStore.getState();
    const projectId = live.share && live.projectId ? live.projectId : null;
    if (projectId === useComments.getState().projectId) {
      syncRail();
      return;
    }
    uninstall();
    cancelReload();
    forgetElsewhere();
    loadToken += 1;
    statusToken += 1;
    useComments.setState(blank(projectId));
    useCommentsRail.setState({ visible: false, canCompose: false, unread: false, request: null, reveal: null });
    if (projectId) void refreshStatus();
  };

  const reload = async (local: boolean) => {
    reloadTimer = null;
    const before = useComments.getState().threads;
    const after = await load(useComments.getState().path);
    if (!local && after && othersWrote(before, after, commentSelf())) noteUnseen();
  };

  anchorListener = ({ emptied, edited }) => {
    const state = useComments.getState();
    if (!commentsShown(state.status) || state.path === null) return;
    if (!sameIds(state.emptied, emptied)) useComments.setState({ emptied: [...emptied] });
    if (!edited) return;
    if (anchorTimer !== null) clearTimeout(anchorTimer);
    anchorTimer = setTimeout(() => {
      anchorTimer = null;
      if (reloadTimer === null) void reload(true);
    }, ANCHOR_RELOAD_MS);
  };

  const scheduleElsewhere = (payload: CollabCommentsChanged) => {
    for (const path of payload.paths) touched.add(path);
    for (const [path, entry] of Object.entries(useComments.getState().elsewhere)) {
      if (entry.threads.some((thread) => payload.fileIds.includes(thread.fileId))) touched.add(path);
    }
    if (elsewhereTimer !== null) clearTimeout(elsewhereTimer);
    elsewhereTimer = setTimeout(() => {
      elsewhereTimer = null;
      const paths = touched;
      touched = new Set();
      void refreshCounts();
      for (const path of Object.keys(useComments.getState().elsewhere)) {
        if (paths.has(path)) void loadElsewhere(path);
      }
    }, RELOAD_DELAY_MS);
  };

  const onChanged = (payload: CollabCommentsChanged) => {
    const state = useComments.getState();
    if (payload.projectId !== state.projectId) return;
    if (state.status === null || commentsShown(state.status)) noteMentions(payload);
    if (!commentsShown(state.status)) return;
    const here =
      state.path !== null &&
      (payload.paths.includes(state.path) || state.threads.some((thread) => payload.fileIds.includes(thread.fileId)));
    if (here) {
      const local = payload.local && reloadTimer === null;
      cancelReload();
      reloadTimer = setTimeout(() => void reload(local), RELOAD_DELAY_MS);
    } else if (!payload.local && (payload.fileIds.length > 0 || payload.paths.length > 0)) {
      noteUnseen();
    }
    scheduleElsewhere(payload);
  };

  const stopLive = useCollabLiveStore.subscribe((live, previous) => {
    if (live.projectId !== previous.projectId || live.share !== previous.share) openProject();
    if (live.commentsNotSent && live.commentsNotSent !== previous.commentsNotSent) void refreshStatus();
    if (live.role !== previous.role || (live.status?.state === "online" && previous.status?.state !== "online")) {
      syncRail();
      void refreshStatus();
    } else if (live.status?.state !== previous.status?.state) {
      syncRail();
    }
  });
  const stopFiles = useFilesStore.subscribe((files, previous) => {
    if (files.activePath === previous.activePath && files.projectId === previous.projectId) return;
    if (!commentsShown(useComments.getState().status)) return;
    void load(currentPath());
    void refreshCounts();
  });
  const stopRail = useCommentsRail.subscribe((rail, previous) => {
    if (rail.request && rail.request !== previous.request) {
      const request = rail.request;
      useCommentsRail.setState({ request: null });
      if (rail.canCompose) useComments.setState({ draft: request, selectedId: null });
    }
    if (rail.reveal && rail.reveal !== previous.reveal) applyReveal();
  });
  const stopSettings = useSettingsStore.subscribe((settings, previous) => {
    if (settings.railTab === previous.railTab && settings.showTree === previous.showTree) return;
    if (tabOpen() && useCommentsRail.getState().unread) useCommentsRail.setState({ unread: false });
  });
  const listening = [
    onCollabCommentsChanged(onChanged),
    onCollabCommentsStatus((payload) => {
      if (payload.projectId === useComments.getState().projectId) applyStatus(payload.status);
    }),
  ].map((pending) =>
    pending.catch((error: unknown) => {
      void logError("collab comments listen", error);
      return () => undefined;
    }),
  );

  openProject();

  return () => {
    anchorListener = null;
    stopLive();
    stopFiles();
    stopRail();
    stopSettings();
    for (const pending of listening) void pending.then((unlisten) => unlisten());
    uninstall();
    cancelReload();
    forgetElsewhere();
    loadToken += 1;
    statusToken += 1;
    useComments.setState(blank(null));
    useCommentsRail.setState({ visible: false, canCompose: false, unread: false, request: null, reveal: null });
  };
}
