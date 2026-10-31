import type { CollabCommentMember, CollabCommentThread } from "@oleafly/backend-port";
import type { BrowserEngine, SynctexHit, SyncTexOpener } from "@oleafly/compile-port";
import {
  getEditorView,
  gotoLine,
  gotoRange,
  selectWordNearLine,
  waitForEditorDocument,
  type WordContext,
} from "@oleafly/editor";
import { ApiError, type WebApi } from "./api";
import { CompileRunner } from "./compile/runner";
import { forwardSync } from "./compile/sync";
import type { LineMapper } from "./compile/synctex";
import { projectFileFor } from "./compile/target";
import { diffOperation, editsFromOperation, TextOperation } from "@/features/collab/live/ot";
import { type GatewayListener, OfflineError, RefusedError, type SocketFactory, WebGateway } from "./gateway";
import { changesBetween, FileOverlays, mapRange, type OverlaySnapshot, type PlacedRange } from "./overlays";
import type { ChatFrame, CollabEditMode, CollabSuggestion, CommentFrame, SuggestionFrame, WebFile } from "./protocol";
import { abilitiesFor, effectiveMode } from "./roles";
import { WebDocumentSession } from "./session";
import { latestChat, mergePeople, patchCompile, useWeb } from "./store";
import { forgetUnsent, readUnsent, type UnsentTyping, writeUnsent } from "./unsent";

export { OfflineError };

const COMMENT_TRIES = 3;

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
  compile(): void;
  toggleLog(): void;
  showInPdf(): Promise<void>;
  openFromPdf(page: number, x: number, y: number, word?: string, context?: WordContext): Promise<void>;
  openLocation(path: string, line: number): void;
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
  engines?: () => Promise<readonly BrowserEngine[]>;
  openSyncTex?: SyncTexOpener;
  mapLine?: LineMapper;
  instance?: string;
}

interface Entry {
  session: WebDocumentSession;
  overlays: FileOverlays;
  stop: () => void;
}

type PendingReveal =
  | { kind: "thread" | "suggestion"; fileId: string; id: string }
  | { kind: "line"; fileId: string; line: number; compiled?: boolean; word?: string; context?: WordContext };

const SETTLE_MS = 3_000;
const SAVE_UNSENT_MS = 400;
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
function confirmedRange(session: WebDocumentSession, range: PlacedRange): PlacedRange {
  const local = session.text();
  const confirmed = session.confirmed();
  return local === confirmed ? range : mapRange(changesBetween(local, confirmed), range);
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
  readonly compiler: CompileRunner;
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
  private lineReveals = 0;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private kept: Record<string, UnsentTyping>;
  private readonly saved: Set<string>;
  private readonly saves = new Map<string, () => void>();
  private readonly flush = () => this.flushUnsent();

  constructor(projectId: string, options: ControllerOptions) {
    this.projectId = projectId;
    this.options = options;
    this.kept = { ...readUnsent(projectId) };
    this.saved = new Set(Object.keys(this.kept));
    this.gateway = new WebGateway({
      url: options.socketUrl,
      listener: this.listener(),
      createSocket: options.createSocket,
      setTimer: options.setTimer,
      random: options.random,
      probe: () => this.probe(),
      instance: options.instance,
    });
    this.compiler = new CompileRunner({
      api: options.api,
      projectId,
      engines: options.engines,
      openSyncTex: options.openSyncTex,
      openText: (path) => {
        const session = this.sessionFor(path);
        return session?.phase === "open" ? session.text() : null;
      },
      setTimer: options.setTimer,
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
    window.addEventListener("pagehide", this.flush);
    this.gateway.start();
    void this.compiler.start();
  }

  stop(): void {
    this.stopped = true;
    window.removeEventListener("pagehide", this.flush);
    this.flushUnsent();
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    for (const entry of this.entries.values()) {
      entry.stop();
      entry.session.close();
    }
    this.entries.clear();
    this.gateway.stop();
    this.compiler.stop();
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
    for (let attempt = 1; ; attempt += 1) {
      const entry = this.entries.get(draft.fileId);
      if (entry) await this.settled(entry.session);
      const range = entry?.overlays.snapshot().draft ?? { from: draft.from, to: draft.to };
      const session = entry?.session.phase === "open" ? entry.session : null;
      const placed = session ? confirmedRange(session, range) : range;
      try {
        await this.comment({
          action: "create",
          fileId: draft.fileId,
          path: entry?.session.path ?? draft.path,
          from: placed.from,
          to: placed.to,
          rev: session ? session.revision : null,
          body,
          members: this.members(),
        });
        break;
      } catch (error) {
        const moved = error instanceof RefusedError && error.code === "comment_selection_changed";
        if (!moved || attempt >= COMMENT_TRIES) throw error;
      }
    }
    if (useWeb.getState().draft !== draft) return;
    this.entries.get(draft.fileId)?.overlays.setDraft(null);
    useWeb.setState({ draft: null });
  }

  replyComment(thread: CollabCommentThread, body: string): Promise<void> {
    return this.comment({ action: "reply", fileId: thread.fileId, threadId: thread.id, body, members: this.members() });
  }

  editComment(thread: CollabCommentThread, messageId: string, body: string): Promise<void> {
    return this.comment({
      action: "edit",
      fileId: thread.fileId,
      threadId: thread.id,
      messageId,
      body,
      members: this.members(),
    });
  }

  deleteComment(thread: CollabCommentThread, messageId: string): Promise<void> {
    return this.comment({ action: "delete", fileId: thread.fileId, threadId: thread.id, messageId });
  }

  resolveThread(thread: CollabCommentThread): Promise<void> {
    return this.comment({ action: "resolve", fileId: thread.fileId, threadId: thread.id });
  }

  reopenThread(thread: CollabCommentThread): Promise<void> {
    return this.comment({ action: "reopen", fileId: thread.fileId, threadId: thread.id });
  }

  revealThread(thread: CollabCommentThread): void {
    useWeb.setState({ selectedThreadId: thread.id, selectedSuggestionId: null });
    this.revealIn({ kind: "thread", fileId: thread.fileId, id: thread.id });
  }

  revealSuggestion(suggestion: CollabSuggestion): void {
    useWeb.setState({ selectedSuggestionId: suggestion.id, selectedThreadId: null });
    this.revealIn({ kind: "suggestion", fileId: suggestion.fileId, id: suggestion.id });
  }

  acceptSuggestions(ids: string[]): Promise<void> {
    return this.suggestion({ action: "accept", ids });
  }

  rejectSuggestions(ids: string[]): Promise<void> {
    return this.suggestion({ action: "reject", ids });
  }

  withdrawSuggestions(ids: string[]): Promise<void> {
    return this.suggestion({ action: "withdraw", ids });
  }

  acceptFile(fileId: string): Promise<void> {
    return this.suggestion({ action: "accept_file", fileId });
  }

  rejectFile(fileId: string): Promise<void> {
    return this.suggestion({ action: "reject_file", fileId });
  }

  sendChat(body: string): Promise<void> {
    return this.chat({ action: "send", body });
  }

  deleteChat(id: string): Promise<void> {
    return this.chat({ action: "delete", id });
  }

  clearChat(): Promise<void> {
    return this.chat({ action: "clear" });
  }

  unconfirmed(): boolean {
    for (const entry of this.entries.values()) if (entry.session.unconfirmed) return true;
    return false;
  }

  flushUnsent(): void {
    for (const fileId of [...this.saves.keys()]) this.saveUnsent(fileId);
  }

  discardUnsent(): void {
    for (const cancel of this.saves.values()) cancel();
    this.saves.clear();
    this.kept = {};
    this.saved.clear();
    forgetUnsent(this.projectId);
  }

  private queueSave(fileId: string): void {
    if (this.saves.has(fileId)) return;
    const handle = setTimeout(() => this.saveUnsent(fileId), SAVE_UNSENT_MS);
    this.saves.set(fileId, () => clearTimeout(handle));
  }

  private saveUnsent(fileId: string): void {
    this.saves.get(fileId)?.();
    this.saves.delete(fileId);
    const session = this.entries.get(fileId)?.session;
    if (!session || fileId in this.kept) return;
    if (!session.unconfirmed || session.phase === "closed") {
      if (this.saved.delete(fileId)) writeUnsent(this.projectId, fileId, null);
      return;
    }
    const base = session.confirmed();
    const flight = this.gateway.inflight(fileId);
    let after = base;
    try {
      if (flight) after = TextOperation.fromWire(flight.op).apply(base);
    } catch {
      after = base;
    }
    const inflight = after === base ? null : flight;
    this.saved.add(fileId);
    writeUnsent(this.projectId, fileId, {
      base,
      inflight,
      rest: diffOperation(after, session.text()).toWire(),
      at: Date.now(),
    });
  }

  private restoreUnsent(fileId: string, session: WebDocumentSession): void {
    const kept = this.kept[fileId];
    if (!kept) return;
    delete this.kept[fileId];
    try {
      if (session.readOnly) useWeb.setState({ discarded: "read_only" });
      else if (!session.unconfirmed) {
        let base = kept.base;
        let typing = TextOperation.fromWire(kept.rest);
        if (kept.inflight) {
          const flight = TextOperation.fromWire(kept.inflight.op);
          if (this.gateway.resumedOf(fileId) === true) base = flight.apply(base);
          else typing = flight.compose(typing);
        }
        const [mine] = TextOperation.transform(typing, diffOperation(base, session.text()));
        if (!mine.isNoop()) session.applyLocal(editsFromOperation(mine), session.version());
      }
    } catch {
      useWeb.setState({ discarded: "refused" });
    }
    this.saveUnsent(fileId);
  }

  compile(): void {
    void this.compiler.compile();
  }

  toggleLog(): void {
    patchCompile({ logOpen: !useWeb.getState().compile.logOpen });
  }

  async showInPdf(): Promise<void> {
    const path = useWeb.getState().activePath;
    const index = path ? await this.compiler.syncIndex() : null;
    if (!path || !index) return;
    useWeb.setState(useWeb.getState().view === "source" ? { view: "pdf", side: "pdf" } : { side: "pdf" });
    try {
      await forwardSync(index, path, undefined, (line) => this.mappedLine(path, line, true));
    } catch {
      this.compiler.dropSyncIndex();
    }
  }

  async openFromPdf(page: number, x: number, y: number, word?: string, context?: WordContext): Promise<void> {
    const index = await this.compiler.syncIndex();
    let hit: SynctexHit | null = null;
    try {
      hit = index ? await index.inverse(page, x, y) : null;
    } catch {
      this.compiler.dropSyncIndex();
    }
    if (!hit || this.stopped) return;
    const file = projectFileFor(hit.file, useWeb.getState().files);
    if (file) this.revealIn({ kind: "line", fileId: file.fileId, line: hit.line, compiled: true, word, context });
  }

  openLocation(path: string, line: number): void {
    const file = projectFileFor(path, useWeb.getState().files);
    if (file) this.revealIn({ kind: "line", fileId: file.fileId, line });
  }

  private async mappedLine(path: string, line: number, currentToCompiled: boolean): Promise<number | null> {
    const compiled = this.compiler.compiledSource(path);
    const current = this.sessionFor(path)?.text() ?? null;
    if (compiled === null || current === null || compiled === current || !this.options.mapLine) return line;
    try {
      return (await this.options.mapLine(compiled, current, line, currentToCompiled))?.line ?? null;
    } catch {
      return null;
    }
  }

  private comment(frame: CommentFrame): Promise<void> {
    return this.gateway.request({ t: "comment", ...frame });
  }

  private suggestion(frame: SuggestionFrame): Promise<void> {
    return this.gateway.request({ t: "suggestion", ...frame });
  }

  private chat(frame: ChatFrame): Promise<void> {
    return this.gateway.request({ t: "chat", ...frame });
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
          this.restoreUnsent(file.fileId, session);
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
    const stopEdits = session.onEdit((edit) => {
      overlays?.edit(edit);
      if (!edit.local) return;
      this.compiler.edited();
      this.queueSave(file.fileId);
    });
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
    const kept = this.kept[file.fileId];
    if (kept?.inflight) this.gateway.resumeOnOpen(file.fileId, kept.inflight.id);
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
    if (target.kind === "line") {
      this.reveal = null;
      const ticket = ++this.lineReveals;
      const path = entry.session.path;
      const line = target.compiled ? this.mappedLine(path, target.line, false) : Promise.resolve(target.line);
      void line.then(async (shown) => {
        const view = shown === null ? null : await waitForEditorDocument(path);
        if (shown === null || !view || ticket !== this.lineReveals || this.stopped) return;
        if (!target.word || !selectWordNearLine(shown, target.word, target.context)) gotoLine(shown);
      });
      return;
    }
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
        if (info.fresh) {
          this.frames.threads.clear();
          this.frames.suggestions.clear();
        }
        useWeb.setState({
          role: info.role,
          roleChanged: this.greeted && info.role !== state.role ? info.role : state.roleChanged,
          features: info.features,
          people: mergePeople(state.people, info.people),
          compileSettings: info.compile,
          ...(info.fresh ? { threads: {}, suggestions: {} } : {}),
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
      chat: (messages) => useWeb.setState({ chat: latestChat(messages) }),
      output: (items) => useWeb.setState({ output: items }),
      compile: (settings) => useWeb.setState({ compileSettings: settings }),
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
          for (const entry of this.entries.values()) {
            if (!this.gateway.holds(entry.session.fileId)) void entry.session.open();
          }
        }
      },
      delivered: (fileId) => {
        const entry = this.entries.get(fileId);
        if (!entry) return;
        entry.overlays.settle();
        if (entry.session.unconfirmed) this.queueSave(fileId);
        else if (!(fileId in this.kept)) this.saveUnsent(fileId);
      },
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
