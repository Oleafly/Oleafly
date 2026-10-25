import { create } from "zustand";
import { getEditorDocumentPath, getEditorView, subscribeEditorDocument } from "@oleafly/editor";
import { useCommentsRail } from "@/components/collab/comments-rail";
import { setSuggestionsEditorExtension } from "@/components/editor/cm/suggestions-slot";
import { i18n } from "@/i18n";
import { installReviewNotice, type ReviewAction } from "@/lib/collab-live-bridge";
import { formatNumber } from "@/lib/intl";
import { logError } from "@/lib/log";
import { toast } from "@/lib/toast";
import type {
  CollabCommentThread,
  CollabErrorCode,
  CollabSuggestion,
  CollabSuggestionCount,
  CollabSuggestionsChanged,
} from "@/lib/tauri";
import {
  collabSuggestionAccept,
  collabSuggestionAcceptFile,
  collabSuggestionCounts,
  collabSuggestionList,
  collabSuggestionReject,
  collabSuggestionRejectFile,
  collabSuggestionReply,
  collabSuggestionWithdraw,
  onCollabSuggestionsChanged,
} from "@/lib/tauri-collab";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import {
  catchUp,
  commentMembers,
  freshness,
  openSession,
  reloadThreads,
  replyToThread,
  useComments,
} from "../comments/comments-store";
import { collabErrorCode } from "../errors";
import { useCollabLiveStore } from "../live/live-store";
import { peerHue } from "../live/peer-hue";
import {
  editorSuggestions,
  revealSuggestion,
  type EditorSuggestionsSource,
  type SuggestionSpan,
} from "./editor-suggestions";

export type SuggestionsPhase = "idle" | "loading" | "ready" | "failed";

export interface FileSuggestions {
  phase: SuggestionsPhase;
  suggestions: CollabSuggestion[];
  error: CollabErrorCode | null;
}

export interface SuggestionsState {
  projectId: string | null;
  path: string | null;
  suggestions: CollabSuggestion[];
  phase: SuggestionsPhase;
  error: CollabErrorCode | null;
  counts: readonly CollabSuggestionCount[] | null;
  elsewhere: Readonly<Record<string, FileSuggestions>>;
  selectedId: string | null;
  hoveredId: string | null;
  focus: number;
}

const RELOAD_DELAY_MS = 150;
const LIST_ATTEMPTS = 5;
const RETRY_REVEAL_MS = 120;
export const REVIEW_TOAST_KEY = "collab-unreviewed-suggestions";

function blank(projectId: string | null): Omit<SuggestionsState, "focus"> {
  return {
    projectId,
    path: null,
    suggestions: [],
    phase: "idle",
    error: null,
    counts: null,
    elsewhere: {},
    selectedId: null,
    hoveredId: null,
  };
}

export const useSuggestions = create<SuggestionsState>(() => ({ ...blank(null), focus: 0 }));

export function byPosition(suggestions: readonly CollabSuggestion[]): CollabSuggestion[] {
  return [...suggestions].sort(
    (left, right) => left.from - right.from || left.to - right.to || left.createdAt - right.createdAt,
  );
}

export function pendingTotal(state: Pick<SuggestionsState, "counts" | "suggestions">): number {
  if (state.counts === null) return state.suggestions.length;
  return state.counts.reduce((total, count) => total + count.pending, 0);
}

export function pendingIn(state: Pick<SuggestionsState, "counts">, path: string): number {
  return state.counts?.find((count) => count.path === path)?.pending ?? 0;
}

export function suggestionSelf(): string | null {
  return useCollabLiveStore.getState().share?.account_id ?? null;
}

function authorName(accountId: string): string {
  return (
    useCollabLiveStore.getState().members.find((member) => member.person.account_id === accountId)?.person
      .display_name || i18n.t(($) => $.collab.toolbar.unknownPerson)
  );
}

export function suggestionLabel(suggestion: CollabSuggestion): string {
  if (!suggestion.verified) return i18n.t(($) => $.collab.suggestions.unverifiedLabel);
  const name = authorName(suggestion.author);
  return suggestion.kind === "insert"
    ? i18n.t(($) => $.collab.suggestions.insertedBy, { name })
    : i18n.t(($) => $.collab.suggestions.deletedBy, { name });
}

const spanCache = new WeakMap<CollabSuggestion[], readonly SuggestionSpan[]>();

function spansOf(suggestions: CollabSuggestion[]): readonly SuggestionSpan[] {
  const cached = spanCache.get(suggestions);
  if (cached) return cached;
  const self = suggestionSelf();
  const spans = suggestions.map((suggestion) => ({
    id: suggestion.id,
    kind: suggestion.kind,
    from: suggestion.from,
    to: suggestion.kind === "delete" ? suggestion.from : suggestion.to,
    text: suggestion.text,
    hue: peerHue(suggestion.author, self),
    label: suggestionLabel(suggestion),
  }));
  spanCache.set(suggestions, spans);
  return spans;
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
  const { path } = useSuggestions.getState();
  if (!view || !path || getEditorDocumentPath() !== path) return false;
  return revealSuggestion(view, id);
}

export function selectSuggestion(id: string | null, options: { reveal?: boolean; focus?: boolean } = {}): void {
  useSuggestions.setState((state) => ({ selectedId: id, focus: options.focus ? state.focus + 1 : state.focus }));
  if (!id || !options.reveal) return;
  queueMicrotask(() => {
    if (!revealInEditor(id)) setTimeout(() => revealInEditor(id), RETRY_REVEAL_MS);
  });
}

export function hoverSuggestion(id: string | null): void {
  if (useSuggestions.getState().hoveredId === id) return;
  useSuggestions.setState((state) => ({ hoveredId: id, focus: id ? state.focus + 1 : state.focus }));
}

export function openSuggestionFromEditor(id: string): void {
  selectSuggestion(id, { focus: true });
  const settings = useSettingsStore.getState();
  if (settings.showTree && settings.railTab !== "comments") settings.setRailTab("comments");
}

let revealAfterLoad: { path: string; id: string } | null = null;

export function openSuggestionIn(path: string, id: string): void {
  if (path === useSuggestions.getState().path) {
    selectSuggestion(id, { reveal: true });
    return;
  }
  revealAfterLoad = { path, id };
  const files = useFilesStore.getState();
  void files.openFile(path).catch((error: unknown) => logError("open suggested file", error));
}

function applyReveal(path: string, suggestions: readonly CollabSuggestion[]): void {
  const wanted = revealAfterLoad;
  if (!wanted || wanted.path !== path) return;
  revealAfterLoad = null;
  if (suggestions.some((suggestion) => suggestion.id === wanted.id)) {
    selectSuggestion(wanted.id, { reveal: true, focus: true });
  }
}

function sameData(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function keepUnchanged(previous: CollabSuggestion[], next: CollabSuggestion[]): CollabSuggestion[] {
  const known = new Map(previous.map((suggestion) => [suggestion.id, suggestion]));
  const kept = next.map((suggestion) => {
    const old = known.get(suggestion.id);
    return old && sameData(old, suggestion) ? old : suggestion;
  });
  const same = kept.length === previous.length && kept.every((suggestion, index) => suggestion === previous[index]);
  return same ? previous : kept;
}

function without(
  elsewhere: Readonly<Record<string, FileSuggestions>>,
  path: string,
): Readonly<Record<string, FileSuggestions>> {
  if (!Object.hasOwn(elsewhere, path)) return elsewhere;
  return Object.fromEntries(Object.entries(elsewhere).filter(([key]) => key !== path));
}

let countToken = 0;

async function refreshCounts(): Promise<void> {
  const projectId = useSuggestions.getState().projectId;
  const token = ++countToken;
  if (!projectId) return;
  let counts: CollabSuggestionCount[];
  try {
    counts = await collabSuggestionCounts(projectId);
  } catch (error) {
    if (token !== countToken) return;
    if (collabErrorCode(error) !== "not_found") void logError("collab suggestion counts", error);
    useSuggestions.setState((state) => (state.counts === null ? { counts: [] } : state));
    return;
  }
  if (token !== countToken || useSuggestions.getState().projectId !== projectId) return;
  const pending = counts.filter((count) => count.pending > 0);
  useSuggestions.setState((state) => (sameData(state.counts, pending) ? state : { counts: pending }));
}

const elsewhereTokens = new Map<string, number>();
let elsewhereToken = 0;

function setElsewhere(path: string, change: (entry: FileSuggestions) => FileSuggestions): void {
  useSuggestions.setState((state) => {
    const entry = state.elsewhere[path];
    if (!entry) return state;
    const next = change(entry);
    if (next.phase === entry.phase && next.error === entry.error && next.suggestions === entry.suggestions) return state;
    return { elsewhere: { ...state.elsewhere, [path]: next } };
  });
}

async function loadElsewhere(path: string): Promise<void> {
  const projectId = useSuggestions.getState().projectId;
  if (!projectId) return;
  const token = ++elsewhereToken;
  elsewhereTokens.set(path, token);
  const stale = () => elsewhereTokens.get(path) !== token || useSuggestions.getState().projectId !== projectId;
  try {
    const listed = await collabSuggestionList(projectId, path);
    if (stale()) return;
    setElsewhere(path, (entry) => ({
      phase: "ready",
      error: null,
      suggestions: keepUnchanged(entry.suggestions, byPosition(listed.suggestions)),
    }));
  } catch (error) {
    if (stale()) return;
    const code = collabErrorCode(error);
    if (code !== "not_found") void logError("collab suggestions load", error);
    setElsewhere(path, (entry) =>
      code === "not_found" ? { phase: "ready", error: null, suggestions: [] } : { ...entry, phase: "failed", error: code },
    );
  }
}

export function expandSuggestionsFile(path: string): void {
  if (path === useSuggestions.getState().path) return;
  useSuggestions.setState((state) => {
    const entry = state.elsewhere[path];
    if (entry && entry.phase !== "failed") return state;
    return {
      elsewhere: { ...state.elsewhere, [path]: { phase: "loading", suggestions: entry?.suggestions ?? [], error: null } },
    };
  });
  void loadElsewhere(path);
}

export function collapseSuggestionsFile(path: string): void {
  useSuggestions.setState((state) => {
    const elsewhere = without(state.elsewhere, path);
    return elsewhere === state.elsewhere ? state : { elsewhere };
  });
}

let loadToken = 0;

async function currentList(projectId: string, path: string, token: number): Promise<CollabSuggestion[] | null> {
  for (let attempt = 1; ; attempt += 1) {
    const listed = await collabSuggestionList(projectId, path);
    if (token !== loadToken) return null;
    const session = openSession(path);
    const verdict = freshness(session, listed.rev);
    if (!session || verdict === "current" || attempt >= LIST_ATTEMPTS) return listed.suggestions;
    await catchUp(path, session, verdict);
    if (token !== loadToken) return null;
  }
}

async function load(path: string | null): Promise<CollabSuggestion[] | null> {
  const projectId = useSuggestions.getState().projectId;
  const token = ++loadToken;
  if (!projectId || !path) {
    useSuggestions.setState({ path, suggestions: [], phase: "idle", error: null, selectedId: null, hoveredId: null });
    return null;
  }
  if (useSuggestions.getState().path === path) {
    if (useSuggestions.getState().phase !== "ready") useSuggestions.setState({ phase: "loading", error: null });
  } else {
    useSuggestions.setState((state) => {
      const known = state.elsewhere[path];
      return {
        path,
        suggestions: known?.phase === "ready" ? known.suggestions : [],
        phase: "loading",
        error: null,
        selectedId: null,
        hoveredId: null,
        elsewhere: without(state.elsewhere, path),
      };
    });
  }
  let listed: CollabSuggestion[] | null;
  try {
    listed = await currentList(projectId, path, token);
  } catch (error) {
    if (token !== loadToken) return null;
    const code = collabErrorCode(error);
    if (code === "not_found") {
      useSuggestions.setState({ suggestions: [], phase: "ready", error: null, selectedId: null });
      return [];
    }
    void logError("collab suggestions load", error);
    useSuggestions.setState({ phase: "failed", error: code });
    return null;
  }
  if (token !== loadToken || listed === null) return null;
  const suggestions = keepUnchanged(useSuggestions.getState().suggestions, byPosition(listed));
  useSuggestions.setState((state) => ({
    suggestions,
    phase: "ready",
    error: null,
    selectedId: suggestions.some((suggestion) => suggestion.id === state.selectedId) ? state.selectedId : null,
    hoveredId: suggestions.some((suggestion) => suggestion.id === state.hoveredId) ? state.hoveredId : null,
  }));
  applyReveal(path, suggestions);
  return suggestions;
}

function currentPath(): string | null {
  const files = useFilesStore.getState();
  return files.projectId !== null && files.projectId === useSuggestions.getState().projectId ? files.activePath : null;
}

export function reloadSuggestions(): void {
  void load(currentPath());
}

function requireProject(): string {
  const projectId = useSuggestions.getState().projectId;
  if (!projectId) throw new Error("This project is not shared.");
  return projectId;
}

function dropLocally(remove: (suggestion: CollabSuggestion) => boolean): void {
  useSuggestions.setState((state) => {
    const filter = (list: CollabSuggestion[]) => {
      const kept = list.filter((suggestion) => !remove(suggestion));
      return kept.length === list.length ? list : kept;
    };
    const suggestions = filter(state.suggestions);
    const elsewhere = Object.fromEntries(
      Object.entries(state.elsewhere).map(([path, entry]) => [path, { ...entry, suggestions: filter(entry.suggestions) }]),
    );
    const selectedId = suggestions.some((suggestion) => suggestion.id === state.selectedId) ? state.selectedId : null;
    return { suggestions, elsewhere, selectedId };
  });
  void refreshCounts();
}

async function resolve(
  ids: readonly string[],
  call: (projectId: string, ids: string[]) => Promise<void>,
): Promise<void> {
  if (ids.length === 0) return;
  await call(requireProject(), [...ids]);
  const gone = new Set(ids);
  dropLocally((suggestion) => gone.has(suggestion.id));
}

export function acceptSuggestions(ids: readonly string[]): Promise<void> {
  return resolve(ids, collabSuggestionAccept);
}

export function rejectSuggestions(ids: readonly string[]): Promise<void> {
  return resolve(ids, collabSuggestionReject);
}

export function withdrawSuggestions(ids: readonly string[]): Promise<void> {
  return resolve(ids, collabSuggestionWithdraw);
}

function fileIdsAt(path: string): Set<string> {
  const state = useSuggestions.getState();
  const list = path === state.path ? state.suggestions : (state.elsewhere[path]?.suggestions ?? []);
  return new Set(list.map((suggestion) => suggestion.fileId));
}

export async function acceptFile(path: string): Promise<void> {
  const fileIds = fileIdsAt(path);
  await collabSuggestionAcceptFile(requireProject(), path);
  dropLocally((suggestion) => fileIds.has(suggestion.fileId));
}

export async function rejectFile(path: string): Promise<void> {
  const fileIds = fileIdsAt(path);
  await collabSuggestionRejectFile(requireProject(), path);
  dropLocally((suggestion) => fileIds.has(suggestion.fileId));
}

export function suggestionThread(suggestion: CollabSuggestion): CollabCommentThread | null {
  if (!suggestion.threadId) return null;
  const comments = useComments.getState();
  const lists = [comments.threads, ...Object.values(comments.elsewhere).map((entry) => entry.threads)];
  for (const list of lists) {
    const found = list.find((thread) => thread.id === suggestion.threadId);
    if (found) return found;
  }
  return null;
}

function linkThread(id: string, threadId: string): void {
  useSuggestions.setState((state) => {
    const link = (list: CollabSuggestion[]) =>
      list.some((suggestion) => suggestion.id === id)
        ? list.map((suggestion) => (suggestion.id === id ? { ...suggestion, threadId } : suggestion))
        : list;
    return {
      suggestions: link(state.suggestions),
      elsewhere: Object.fromEntries(
        Object.entries(state.elsewhere).map(([path, entry]) => [path, { ...entry, suggestions: link(entry.suggestions) }]),
      ),
    };
  });
}

export async function replyToSuggestion(suggestion: CollabSuggestion, body: string): Promise<void> {
  const thread = suggestionThread(suggestion);
  if (thread) {
    await replyToThread(thread, body);
    return;
  }
  const created = await collabSuggestionReply(requireProject(), suggestion.id, body, commentMembers());
  linkThread(suggestion.id, created.id);
  reloadThreads();
}

const announced = new Map<string, number>();

export function announceUnreviewed(projectId: string, action: ReviewAction): void {
  const state = useSuggestions.getState();
  if (state.projectId !== projectId) return;
  const total = pendingTotal(state);
  const key = `${projectId}\0${action}`;
  if (total === 0) {
    announced.delete(key);
    return;
  }
  if (announced.get(key) === total) return;
  announced.set(key, total);
  const number = formatNumber(total);
  toast.infoUnique(
    REVIEW_TOAST_KEY,
    action === "export"
      ? i18n.t(($) => $.collab.suggestions.pendingExport, { number })
      : i18n.t(($) => $.collab.suggestions.pendingCompile, { number }),
  );
}

export function forgetAnnouncements(): void {
  announced.clear();
}

const source: EditorSuggestionsSource = {
  snapshot: () => {
    const state = useSuggestions.getState();
    return { path: state.path, spans: spansOf(state.suggestions), active: state.hoveredId ?? state.selectedId };
  },
  documentPath: getEditorDocumentPath,
  subscribe: (listener) => {
    const stopStore = useSuggestions.subscribe(() => listener());
    const stopDocument = subscribeEditorDocument(() => listener());
    return () => {
      stopStore();
      stopDocument();
    };
  },
  open: openSuggestionFromEditor,
  hover: hoverSuggestion,
};

export function startSuggestions(): () => void {
  let release: (() => void) | null = null;
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  let elsewhereTimer: ReturnType<typeof setTimeout> | null = null;
  let touched = new Set<string>();

  const cancelTimers = () => {
    if (reloadTimer !== null) clearTimeout(reloadTimer);
    reloadTimer = null;
    if (elsewhereTimer !== null) clearTimeout(elsewhereTimer);
    elsewhereTimer = null;
    touched = new Set();
  };

  const syncRail = () => {
    const pending = pendingTotal(useSuggestions.getState()) > 0;
    if (useCommentsRail.getState().suggestions !== pending) useCommentsRail.setState({ suggestions: pending });
  };

  const live = () => {
    const state = useCollabLiveStore.getState();
    return state.share !== null && state.projectId !== null && state.role !== null;
  };

  const openProject = () => {
    const state = useCollabLiveStore.getState();
    const projectId = state.share && state.projectId ? state.projectId : null;
    if (projectId === useSuggestions.getState().projectId) return;
    cancelTimers();
    loadToken += 1;
    countToken += 1;
    elsewhereTokens.clear();
    forgetAnnouncements();
    revealAfterLoad = null;
    useSuggestions.setState(blank(projectId));
    if (projectId && live()) {
      void load(currentPath());
      void refreshCounts();
    }
  };

  const onChanged = (payload: CollabSuggestionsChanged) => {
    const state = useSuggestions.getState();
    if (payload.projectId !== state.projectId) return;
    const here = state.path !== null && (payload.paths.length === 0 || payload.paths.includes(state.path));
    if (here) {
      if (reloadTimer !== null) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        reloadTimer = null;
        void load(useSuggestions.getState().path);
      }, RELOAD_DELAY_MS);
    }
    if (!payload.local) noteUnseen();
    for (const path of payload.paths) touched.add(path);
    if (elsewhereTimer !== null) clearTimeout(elsewhereTimer);
    elsewhereTimer = setTimeout(() => {
      elsewhereTimer = null;
      const paths = touched;
      touched = new Set();
      void refreshCounts();
      for (const path of Object.keys(useSuggestions.getState().elsewhere)) {
        if (paths.size === 0 || paths.has(path)) void loadElsewhere(path);
      }
    }, RELOAD_DELAY_MS);
  };

  const stopLive = useCollabLiveStore.subscribe((state, previous) => {
    if (state.projectId !== previous.projectId || state.share !== previous.share) {
      openProject();
      return;
    }
    const cameOnline = state.status?.state === "online" && previous.status?.state !== "online";
    if ((state.role !== previous.role || cameOnline) && live()) {
      void load(currentPath());
      void refreshCounts();
    }
  });
  const stopFiles = useFilesStore.subscribe((files, previous) => {
    if (files.activePath === previous.activePath && files.projectId === previous.projectId) return;
    if (!useSuggestions.getState().projectId || !live()) return;
    void load(currentPath());
    void refreshCounts();
  });
  const stopRail = useSuggestions.subscribe((state, previous) => {
    if (state.counts !== previous.counts || state.suggestions !== previous.suggestions) syncRail();
  });
  const listening = onCollabSuggestionsChanged(onChanged).catch((error: unknown) => {
    void logError("collab suggestions listen", error);
    return () => undefined;
  });

  release = setSuggestionsEditorExtension(editorSuggestions(source));
  const releaseNotice = installReviewNotice(announceUnreviewed);
  openProject();

  return () => {
    stopLive();
    stopFiles();
    stopRail();
    void listening.then((unlisten) => unlisten());
    release?.();
    release = null;
    releaseNotice();
    cancelTimers();
    loadToken += 1;
    countToken += 1;
    elsewhereTokens.clear();
    forgetAnnouncements();
    useSuggestions.setState({ ...blank(null) });
    useCommentsRail.setState({ suggestions: false });
  };
}
