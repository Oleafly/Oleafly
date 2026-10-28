import type { CollabCommentMember, CollabCommentThread } from "@oleafly/backend-port";
import { getEditorView, gotoRange } from "@oleafly/editor";
import { ApiError, type WebApi } from "./api";
import { type GatewayListener, type SocketFactory, WebGateway } from "./gateway";
import { FileOverlays, type OverlaySnapshot, type PlacedRange } from "./overlays";
import type {
  ChatFrame,
  ClientFrame,
  CollabEditMode,
  CollabSuggestion,
  CommentFrame,
  SuggestionFrame,
  WebFile,
} from "./protocol";
import { abilitiesFor, effectiveMode } from "./roles";
import { WebDocumentSession } from "./session";
import { mergeChat, mergePeople, useWeb } from "./store";

export class OfflineError extends Error {
  constructor() {
    super("offline");
    this.name = "OfflineError";
  }
}

export interface ProjectActions {
  openFile(fileId: string): void;
  setMode(mode: CollabEditMode): void;
  startComment(): void;
  cancelComment(): void;
  createComment(body: string): Promise<void>;
  replyComment(thread: CollabCommentThread, body: string): Promise<void>;
  editComment(thread: CollabCommentThread, messageId: string, body: string): Promise<void>;
  deleteComment(thread: CollabCommentThread, messageId: string): Promise<void>;
  resolveThread(thread: CollabCommentThread): Promise<void>;
  reopenThread(thread: CollabCommentThread): Promise<void>;
  revealThread(thread: CollabCommentThread): void;
  revealSuggestion(suggestion: CollabSuggestion): void;
  acceptSuggestions(ids: string[]): Promise<void>;
  rejectSuggestions(ids: string[]): Promise<void>;
  withdrawSuggestions(ids: string[]): Promise<void>;
  acceptFile(fileId: string): Promise<void>;
  rejectFile(fileId: string): Promise<void>;
  sendChat(body: string): Promise<void>;
  deleteChat(id: string): Promise<void>;
  clearChat(): Promise<void>;
}

export interface EditorBridge {
  sessionFor(path: string): WebDocumentSession | null;
  overlaysFor(path: string | null): OverlaySnapshot | null;
  subscribeOverlays(listener: () => void): () => void;
  selectionChanged(anchor: number, head: number): void;
}

export interface ControllerOptions {
  api: WebApi;
  socketUrl: string;
  createSocket?: SocketFactory;
  setTimer?: (run: () => void, ms: number) => () => void;
  random?: () => number;
  settleMs?: number;
}

interface Entry {
  session: WebDocumentSession;
  overlays: FileOverlays;
  stop: () => void;
}

type PendingReveal = { kind: "thread" | "suggestion"; fileId: string; id: string };

const SETTLE_MS = 3_000;
const PRESENCE_MS = 150;
const MAIN_FILES = ["main.tex", "main.typ", "main.md", "index.md", "README.md"];

function pickMainFile(files: readonly WebFile[]): WebFile | null {
  const texts = files.filter((file) => file.kind === "text");
  for (const name of MAIN_FILES) {
    const match = texts.find((file) => file.path === name);
    if (match) return match;
  }
  const sorted = [...texts].sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path));
  return sorted.find((file) => /\.(?:tex|typ|md)$/iu.test(file.path)) ?? sorted[0] ?? null;
}

function remember(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function recall(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export class ProjectController implements ProjectActions, EditorBridge {
  readonly gateway: WebGateway;
  private readonly projectId: string;
  private readonly options: ControllerOptions;
  private readonly entries = new Map<string, Entry>();
  private readonly overlayListeners = new Set<() => void>();
  private readonly frames = {
    threads: new Map<string, { rev: number | null; items: CollabCommentThread[] }>(),
    suggestions: new Map<string, { rev: number | null; items: CollabSuggestion[] }>(),
  };
  private greeted = false;
  private stopped = false;
  private reveal: PendingReveal | null = null;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(projectId: string, options: ControllerOptions) {
    this.projectId = projectId;
    this.options = options;
    this.gateway = new WebGateway({
      url: options.socketUrl,
      listener: this.listener(),
      createSocket: options.createSocket,
      setTimer: options.setTimer,
      random: options.random,
      probe: () => this.probe(),
    });
  }

  async start(): Promise<void> {
    useWeb.setState({ projectId: this.projectId, connection: "connecting", end: null });
    try {
      const detail = await this.options.api.project(this.projectId);
      if (this.stopped) return;
      const state = useWeb.getState();
      useWeb.setState({
        title: detail.project.title,
        owner: detail.project.owner,
        role: detail.role,
        features: detail.features,
        files: state.files.length > 0 ? state.files : detail.files,
        people: mergePeople(state.people, [detail.project.owner, ...detail.people]),
      });
    } catch (error) {
      if (this.stopped) return;
      if (error instanceof ApiError && error.status === 401) {
        useWeb.setState({ connection: "ended", end: "signed_out" });
        return;
      }
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
        useWeb.setState({ connection: "ended", end: "no_access" });
        return;
      }
    }
    if (this.stopped) return;
    this.gateway.start();
  }

  stop(): void {
    this.stopped = true;
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    for (const entry of this.entries.values()) {
      entry.stop();
      entry.session.close();
    }
    this.entries.clear();
    this.gateway.stop();
  }

  sessionFor(path: string): WebDocumentSession | null {
    for (const entry of this.entries.values()) if (entry.session.path === path) return entry.session;
    return null;
  }

  overlaysFor(path: string | null): OverlaySnapshot | null {
    if (!path) return null;
    for (const entry of this.entries.values()) {
      if (entry.session.path === path) return entry.overlays.snapshot();
    }
    return null;
  }

  subscribeOverlays(listener: () => void): () => void {
    this.overlayListeners.add(listener);
    return () => {
      this.overlayListeners.delete(listener);
    };
  }

  selectionChanged(anchor: number, head: number): void {
    const current = useWeb.getState().selection;
    const next: PlacedRange | null = anchor === head ? null : { from: Math.min(anchor, head), to: Math.max(anchor, head) };
    if (current?.from !== next?.from || current?.to !== next?.to) useWeb.setState({ selection: next });
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      const state = useWeb.getState();
      if (state.activePath) this.gateway.setPresence(state.activeFileId, anchor, head);
    }, PRESENCE_MS);
  }

  openFile(fileId: string): void {
    const state = useWeb.getState();
    const file = state.files.find((entry) => entry.fileId === fileId);
    if (!file || file.kind === "dir") return;
    if (file.kind === "blob") {
      useWeb.setState({
        activeFileId: fileId,
        activePath: null,
        docVersion: state.docVersion + 1,
        view: "source",
        removedPath: null,
        selection: null,
      });
      this.gateway.setPresence(null, null, null);
      return;
    }
    this.ensureEntry(file);
    useWeb.setState({
      activeFileId: fileId,
      activePath: file.path,
      docVersion: state.docVersion + 1,
      view: "source",
      removedPath: null,
      selection: null,
    });
    this.gateway.setPresence(fileId, 0, 0);
    this.notifyOverlays();
  }

  setMode(mode: CollabEditMode): void {
    const state = useWeb.getState();
    if (!abilitiesFor(state.role, state.features).chooseMode) return;
    useWeb.setState({ chosenMode: mode });
    remember(`oleafly.web.mode.${this.projectId}`, mode);
    this.gateway.setMode(mode);
  }

  startComment(): void {
    const state = useWeb.getState();
    if (!abilitiesFor(state.role, state.features).comment) return;
    const view = getEditorView();
    const fileId = state.activeFileId;
    const path = state.activePath;
    if (!view || !fileId || !path) return;
    const { from, to } = view.state.selection.main;
    if (to <= from) return;
    const quote = view.state.doc.sliceString(from, to);
    this.entries.get(fileId)?.overlays.setDraft({ from, to });
    useWeb.setState({
      draft: { fileId, path, from, to, quote },
      view: "comments",
      side: "comments",
      discussion: "comments",
    });
  }

  cancelComment(): void {
    const draft = useWeb.getState().draft;
    if (draft) this.entries.get(draft.fileId)?.overlays.setDraft(null);
    useWeb.setState({ draft: null });
  }

  async createComment(body: string): Promise<void> {
    const draft = useWeb.getState().draft;
    if (!draft) return;
    const entry = this.entries.get(draft.fileId);
    if (entry) await this.settled(entry.session);
    const range = entry?.overlays.snapshot().draft ?? { from: draft.from, to: draft.to };
    const session = entry?.session;
    const rev = session && session.phase === "open" && session.synchronized ? session.revision : null;
    this.comment({
      action: "create",
      fileId: draft.fileId,
      path: session?.path ?? draft.path,
      from: range.from,
      to: range.to,
      rev,
      body,
      members: this.members(),
    });
    entry?.overlays.setDraft(null);
    useWeb.setState({ draft: null });
  }

  async replyComment(thread: CollabCommentThread, body: string): Promise<void> {
    this.comment({ action: "reply", fileId: thread.fileId, threadId: thread.id, body, members: this.members() });
  }

  async editComment(thread: CollabCommentThread, messageId: string, body: string): Promise<void> {
    this.comment({
      action: "edit",
      fileId: thread.fileId,
      threadId: thread.id,
      messageId,
      body,
      members: this.members(),
    });
  }

  async deleteComment(thread: CollabCommentThread, messageId: string): Promise<void> {
    this.comment({ action: "delete", fileId: thread.fileId, threadId: thread.id, messageId });
  }

  async resolveThread(thread: CollabCommentThread): Promise<void> {
    this.comment({ action: "resolve", fileId: thread.fileId, threadId: thread.id });
  }

  async reopenThread(thread: CollabCommentThread): Promise<void> {
    this.comment({ action: "reopen", fileId: thread.fileId, threadId: thread.id });
  }

  revealThread(thread: CollabCommentThread): void {
    useWeb.setState({ selectedThreadId: thread.id, selectedSuggestionId: null });
    this.revealIn({ kind: "thread", fileId: thread.fileId, id: thread.id });
  }

  revealSuggestion(suggestion: CollabSuggestion): void {
    useWeb.setState({ selectedSuggestionId: suggestion.id, selectedThreadId: null });
    this.revealIn({ kind: "suggestion", fileId: suggestion.fileId, id: suggestion.id });
  }

  async acceptSuggestions(ids: string[]): Promise<void> {
    this.suggestion({ action: "accept", ids });
  }

  async rejectSuggestions(ids: string[]): Promise<void> {
    this.suggestion({ action: "reject", ids });
  }

  async withdrawSuggestions(ids: string[]): Promise<void> {
    this.suggestion({ action: "withdraw", ids });
  }

  async acceptFile(fileId: string): Promise<void> {
    this.suggestion({ action: "accept_file", fileId });
  }

  async rejectFile(fileId: string): Promise<void> {
    this.suggestion({ action: "reject_file", fileId });
  }

  async sendChat(body: string): Promise<void> {
    this.chat({ action: "send", body });
  }

  async deleteChat(id: string): Promise<void> {
    this.chat({ action: "delete", id });
  }

  async clearChat(): Promise<void> {
    this.chat({ action: "clear" });
  }

  private send(frame: ClientFrame): void {
    if (!this.gateway.send(frame)) throw new OfflineError();
  }

  private comment(frame: CommentFrame): void {
    this.send({ t: "comment", ...frame });
  }

  private suggestion(frame: SuggestionFrame): void {
    this.send({ t: "suggestion", ...frame });
  }

  private chat(frame: ChatFrame): void {
    this.send({ t: "chat", ...frame });
  }

  private members(): CollabCommentMember[] {
    return Object.values(useWeb.getState().people)
      .filter((person) => person.name)
      .map((person) => ({ accountId: person.accountId, displayName: person.name, login: person.login }));
  }

  private async settled(session: WebDocumentSession): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        session.settled(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, this.options.settleMs ?? SETTLE_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private suggesting(): boolean {
    const state = useWeb.getState();
    return effectiveMode(state.role, state.chosenMode, state.features) === "suggesting";
  }

  private ensureEntry(file: WebFile): Entry {
    const existing = this.entries.get(file.fileId);
    if (existing) return existing;
    let overlays: FileOverlays | null = null;
    const session = new WebDocumentSession(file.fileId, file.path, "", {
      transport: this.gateway.transport,
      readOnly: () => {
        const state = useWeb.getState();
        return !abilitiesFor(state.role, state.features).edit;
      },
      onPhase: (phase) => {
        if (phase === "open") {
          const loaded = useWeb.getState().loaded;
          if (!loaded[file.fileId]) useWeb.setState({ loaded: { ...loaded, [file.fileId]: true } });
        }
        overlays?.settle();
        this.revealPending();
      },
      onDiscarded: (reason) => useWeb.setState({ discarded: reason }),
    });
    overlays = new FileOverlays(session, {
      self: () => useWeb.getState().me?.accountId ?? null,
      suggesting: () => this.suggesting(),
    });
    const stopEdits = session.onEdit((edit) => overlays?.edit(edit));
    const stopOverlays = overlays.subscribe(() => {
      this.notifyOverlays();
      this.revealPending();
    });
    const entry: Entry = {
      session,
      overlays,
      stop: () => {
        stopEdits();
        stopOverlays();
      },
    };
    this.entries.set(file.fileId, entry);
    const threads = this.frames.threads.get(file.fileId);
    if (threads) overlays.setThreads(threads.rev, threads.items);
    const suggestions = this.frames.suggestions.get(file.fileId);
    if (suggestions) overlays.setSuggestions(suggestions.rev, suggestions.items);
    void session.open();
    return entry;
  }

  private notifyOverlays(): void {
    for (const listener of Array.from(this.overlayListeners)) listener();
  }

  private revealIn(target: PendingReveal): void {
    this.reveal = target;
    if (useWeb.getState().activeFileId !== target.fileId) this.openFile(target.fileId);
    else useWeb.setState({ view: "source" });
    this.revealPending();
  }

  private revealPending(): void {
    const target = this.reveal;
    if (!target) return;
    const entry = this.entries.get(target.fileId);
    if (entry?.session.phase !== "open" || useWeb.getState().activeFileId !== target.fileId) return;
    const range =
      target.kind === "thread" ? entry.overlays.threadRange(target.id) : entry.overlays.suggestionRange(target.id);
    if (!range) return;
    this.reveal = null;
    queueMicrotask(() => {
      if (getEditorView()) gotoRange(range.from, range.to);
    });
  }

  private syncFiles(files: readonly WebFile[]): void {
    const byId = new Map(files.map((file) => [file.fileId, file]));
    const state = useWeb.getState();
    let removedPath: string | null = null;
    for (const [fileId, entry] of Array.from(this.entries)) {
      const file = byId.get(fileId);
      if (file && file.kind === "text") {
        if (entry.session.path !== file.path) entry.session.moveTo(file.path);
        continue;
      }
      if (state.activeFileId === fileId) removedPath = entry.session.path;
      entry.stop();
      entry.session.close();
      this.entries.delete(fileId);
    }
    const active = state.activeFileId ? byId.get(state.activeFileId) : undefined;
    if (state.activeFileId && !active) {
      useWeb.setState({
        files: [...files],
        activeFileId: null,
        activePath: null,
        docVersion: state.docVersion + 1,
        removedPath: removedPath ?? state.activePath,
        draft: null,
      });
      return;
    }
    const activePath = active?.kind === "text" ? active.path : state.activePath;
    useWeb.setState({ files: [...files], activePath: active ? activePath : state.activePath });
  }

  private listener(): GatewayListener {
    return {
      hello: (info) => {
        const state = useWeb.getState();
        useWeb.setState({
          role: info.role,
          roleChanged: this.greeted && info.role !== state.role ? info.role : state.roleChanged,
          features: info.features,
          people: mergePeople(state.people, info.people),
        });
        this.syncFiles(info.files);
        if (!this.greeted) {
          this.greeted = true;
          const stored = recall(`oleafly.web.mode.${this.projectId}`);
          const chosen: CollabEditMode = stored === "suggesting" ? "suggesting" : "editing";
          useWeb.setState({ chosenMode: chosen });
          if (abilitiesFor(info.role, info.features).chooseMode) this.gateway.setMode(chosen);
          if (!useWeb.getState().activeFileId) {
            const main = pickMainFile(info.files);
            if (main) this.openFile(main.fileId);
          }
        }
      },
      tree: (files) => this.syncFiles(files),
      presence: (peers) => {
        const state = useWeb.getState();
        useWeb.setState({
          peers,
          people: mergePeople(
            state.people,
            peers.map((peer) =>
              peer.name ? { accountId: peer.accountId, name: peer.name, avatarUrl: null, login: null } : null,
            ),
          ),
        });
      },
      threads: (frame) => {
        this.frames.threads.set(frame.fileId, { rev: frame.rev, items: frame.threads });
        useWeb.setState({ threads: { ...useWeb.getState().threads, [frame.fileId]: frame.threads } });
        this.entries.get(frame.fileId)?.overlays.setThreads(frame.rev, frame.threads);
      },
      suggestions: (frame) => {
        this.frames.suggestions.set(frame.fileId, { rev: frame.rev, items: frame.suggestions });
        useWeb.setState({ suggestions: { ...useWeb.getState().suggestions, [frame.fileId]: frame.suggestions } });
        this.entries.get(frame.fileId)?.overlays.setSuggestions(frame.rev, frame.suggestions);
      },
      chat: (messages) => useWeb.setState({ chat: mergeChat(useWeb.getState().chat, messages) }),
      output: (items) => useWeb.setState({ output: items }),
      access: (role) => {
        const state = useWeb.getState();
        if (role === state.role) return;
        useWeb.setState({ role, roleChanged: role, draft: abilitiesFor(role, state.features).comment ? state.draft : null });
        if (abilitiesFor(role, state.features).chooseMode) this.gateway.setMode(state.chosenMode);
        useWeb.setState({ docVersion: useWeb.getState().docVersion + 1 });
      },
      error: (code, message) => useWeb.setState({ notice: { code, message, at: Date.now() } }),
      state: (connection, end) => {
        useWeb.setState({ connection, end });
        if (connection === "offline") {
          for (const entry of this.entries.values()) void entry.session.open();
        }
      },
      delivered: (fileId) => this.entries.get(fileId)?.overlays.settle(),
    };
  }

  private async probe(): Promise<"ok" | "signed_out" | "no_access"> {
    try {
      const me = await this.options.api.me();
      if (!me) return "signed_out";
      await this.options.api.project(this.projectId);
      return "ok";
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return "signed_out";
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return "no_access";
      return "ok";
    }
  }
}
