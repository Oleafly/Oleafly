import { i18n } from "@/i18n";
import {
  holdNoteLivePath,
  installNoteLivePort,
  type NoteLiveBindRequest,
  type NoteLiveEditor,
  type NoteLiveEndReason,
  type NoteLiveHandle,
  type NotePeerCaret,
  type NotePeerMark,
  registerNoteCommentSurface,
  showNoteLiveNotice,
  useCollabLiveNote,
} from "@/lib/collab-live-bridge";
import { logError } from "@/lib/log";
import { collabPresenceLeave, collabPresenceSet } from "@/lib/tauri-collab";
import type { CollabProjectRole } from "@/lib/tauri";
import { settledWithin } from "../live/live-sessions";
import { type LivePeer, useCollabLiveStore } from "../live/live-store";
import { createPresencePublisher, inOrder, type PresencePublisher, peerCursors } from "../live/presence";
import { RemoteDocumentSession, type RemoteSessionTransport } from "../live/remote-session";
import { collabSessionTransport } from "../live/transport";
import { canEditProjectRole } from "../roles";
import { NoteLiveBinding, type NoteLiveClock, type NoteLiveSession } from "./note-live";

export interface NotePresenceSender {
  set(projectId: string, path: string, cursor: number, anchor: number): Promise<void>;
  leave(projectId: string): Promise<void>;
}

export interface NoteLiveDeps {
  transport?: (projectId: string) => RemoteSessionTransport;
  presence?: NotePresenceSender;
  clock?: NoteLiveClock;
}

export const NOTE_HAND_BACK_MS = 1_500;
export const NOTE_JUMPER_WAIT_MS = 2_000;

const tauriPresence: NotePresenceSender = {
  set: (projectId, path, cursor, anchor) => collabPresenceSet(projectId, path, cursor, anchor),
  leave: (projectId) => collabPresenceLeave(projectId),
};

type Jumper = (accountId: string) => void;

const jumpers = new Map<string, Jumper>();
const jumperWaiters = new Set<() => void>();

function bindingKey(noteId: string, path: string): string {
  return `${noteId}\u0000${path}`;
}

function setJumper(key: string, jump: Jumper): void {
  jumpers.set(key, jump);
  for (const waiter of jumperWaiters) waiter();
}

export function jumpToNotePeer(noteId: string, accountId: string, path?: string): boolean {
  const jump =
    path === undefined
      ? [...jumpers.entries()].find(([key]) => key.startsWith(`${noteId}\u0000`))?.[1]
      : jumpers.get(bindingKey(noteId, path));
  jump?.(accountId);
  return jump !== undefined;
}

export function jumpToNotePeerWhenBound(
  noteId: string,
  path: string,
  accountId: string,
  waitMs: number = NOTE_JUMPER_WAIT_MS,
): Promise<boolean> {
  if (jumpToNotePeer(noteId, accountId, path)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (found: boolean) => {
      clearTimeout(timer);
      jumperWaiters.delete(check);
      resolve(found);
    };
    const check = () => {
      if (jumpers.has(bindingKey(noteId, path))) done(jumpToNotePeer(noteId, accountId, path));
    };
    const timer = setTimeout(() => done(false), waitMs);
    jumperWaiters.add(check);
  });
}

function roleOf(noteId: string) {
  const state = useCollabLiveStore.getState();
  return state.projectId === noteId ? state.role : null;
}

function roleTracker(noteId: string, start: CollabProjectRole) {
  let known = roleOf(noteId) ?? start;
  const stop = useCollabLiveStore.subscribe((state) => {
    if (state.projectId === noteId && state.role !== null) known = state.role;
  });
  return {
    role: () => (useCollabLiveStore.getState().projectId === noteId ? roleOf(noteId) : known),
    stop,
  };
}

export function peerMarksFor(
  peers: Readonly<Record<string, LivePeer>>,
  path: string,
  blockAt: (offset: number) => number,
  unknownName: string,
): NotePeerMark[] {
  const marks: NotePeerMark[] = [];
  const seen = new Set<string>();
  for (const peer of Object.values(peers)) {
    if (peer.path !== path || peer.cursor === null) continue;
    const index = blockAt(peer.cursor);
    const key = `${peer.accountId}:${index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    marks.push({ id: peer.accountId, name: peer.person?.display_name ?? unknownName, hue: peer.hue, index });
  }
  return marks.sort((left, right) => left.index - right.index || left.name.localeCompare(right.name));
}

export function peerCaretsFor(peers: Readonly<Record<string, LivePeer>>, path: string): NotePeerCaret[] {
  return peerCursors(peers, path).sort((left, right) => left.id.localeCompare(right.id));
}

function presenceFor(noteId: string, path: string, editor: NoteLiveEditor, send: NotePresenceSender) {
  const key = bindingKey(noteId, path);
  const queue = inOrder("live note presence");
  let publisher: PresencePublisher | null = null;
  const publish = () => {
    if (editor.shown?.() === false) {
      publisher?.dispose();
      publisher = null;
      return;
    }
    publisher ??= createPresencePublisher(
      () => {
        const { head, anchor } = editor.selectionOffsets();
        return { path, cursor: head, anchor };
      },
      (presence) => {
        const cursor = presence.cursor ?? 0;
        queue(() => send.set(noteId, path, cursor, presence.anchor ?? cursor));
      },
      () => queue(() => send.leave(noteId)),
    );
    publisher.schedule();
  };
  const unknownName = () => i18n.t(($) => $.notes.live.someone);
  const marks = () => {
    const state = useCollabLiveStore.getState();
    return state.projectId === noteId ? peerMarksFor(state.peers, path, editor.blockAt, unknownName()) : [];
  };
  let applied = 0;
  const reports = new Map<string, { head: number; anchor: number; applied: number }>();
  const refresh = (remoteEdit = false) => {
    const state = useCollabLiveStore.getState();
    const carets = state.projectId === noteId ? peerCaretsFor(state.peers, path) : [];
    if (remoteEdit) applied += 1;
    const replace = new Set<string>();
    const present = new Set<string>();
    for (const caret of carets) {
      present.add(caret.id);
      const seen = reports.get(caret.id);
      if (seen?.head !== caret.head || seen.anchor !== caret.anchor) {
        reports.set(caret.id, { head: caret.head, anchor: caret.anchor, applied });
      } else if (remoteEdit && seen.applied === applied - 1) {
        replace.add(caret.id);
        reports.set(caret.id, { ...seen, applied: Number.NaN });
      }
    }
    for (const id of reports.keys()) {
      if (!present.has(id)) reports.delete(id);
    }
    editor.batch(() => {
      editor.setPeerMarks(marks());
      editor.setPeerCarets(carets, replace);
    });
  };
  let deferred: ReturnType<typeof setTimeout> | null = null;
  const stopCaret = editor.onCaret(() => {
    if (deferred !== null) return;
    deferred = setTimeout(() => {
      deferred = null;
      publish();
    }, 0);
  });
  const unsubscribe = useCollabLiveStore.subscribe((state, previous) => {
    if (state.peers !== previous.peers || state.projectId !== previous.projectId) refresh();
  });
  const jump = (accountId: string) => {
    const mark = marks().find((entry) => entry.id === accountId);
    if (mark) editor.revealBlock(mark.index);
  };
  setJumper(key, jump);
  publish();
  refresh();
  return {
    refresh,
    dispose: (leave: boolean) => {
      publisher?.dispose();
      stopCaret();
      if (deferred !== null) clearTimeout(deferred);
      unsubscribe();
      if (jumpers.get(key) === jump) jumpers.delete(key);
      editor.batch(() => {
        editor.setPeerMarks([]);
        editor.setPeerCarets([]);
      });
      if (leave) queue(() => send.leave(noteId));
    },
  };
}

interface BoundNote {
  noteId: string;
  handle: NoteLiveHandle | null;
}

const bound = new Set<BoundNote>();

function boundElsewhere(entry: BoundNote): boolean {
  return [...bound].some((other) => other !== entry && other.noteId === entry.noteId);
}

function liveView(document: RemoteDocumentSession, writable: () => boolean): NoteLiveSession {
  return {
    get readOnly() {
      return document.readOnly || !writable();
    },
    version: () => document.version(),
    text: () => document.text(),
    applyLocal: (edits, baseVersion) => document.applyLocal(edits, baseVersion),
    subscribe: (listener) => document.subscribe(listener),
    subscribeLocal: (listener) => document.subscribeLocal(listener),
  };
}

function sharedDocument(request: NoteLiveBindRequest): RemoteDocumentSession | null {
  if (request.document === undefined) return null;
  if (request.document instanceof RemoteDocumentSession) return request.document;
  throw new TypeError(`The live editor session for ${request.path} can't be shared.`);
}

export function bindNoteLive(request: NoteLiveBindRequest, deps: NoteLiveDeps = {}): NoteLiveHandle {
  const { noteId, path, editor } = request;
  const shared = sharedDocument(request);
  const roles = roleTracker(noteId, request.session.role);
  const writable = () => canEditProjectRole(roles.role());
  const releaseHold = holdNoteLivePath(request.session.projectId, path);
  let ended = false;
  const entry: BoundNote = { noteId, handle: null };
  let refreshMarks: (remoteEdit: boolean) => void = () => {};
  const surface = {
    serialize: () => editor.serialize(),
    composing: () => editor.composing(),
    show: (previous: string, next: string, keepLocal: boolean) => {
      editor.batch(() => {
        editor.show(previous, next, keepLocal);
        refreshMarks(true);
      });
    },
  };
  const handBack = (reason: NoteLiveEndReason, unsent: boolean) => {
    if (shared) {
      const text = shared.text();
      request.onEnd({ text, base: text, edited: unsent, reason });
      return;
    }
    let base: string;
    try {
      base = session.confirmed();
    } catch {
      base = session.text();
    }
    const edited = unsent || session.unconfirmed;
    const text = session.text();
    session.close();
    request.onEnd({ text, base, edited, reason });
  };
  const end = (reason: NoteLiveEndReason = "released") => {
    if (ended) return;
    ended = true;
    bound.delete(entry);
    stopPhase();
    releaseHold();
    refreshMarks = () => {};
    releaseComments();
    editor.setComments?.({ spans: [], selected: null, draft: null });
    presence.dispose(!boundElsewhere(entry) && useCollabLiveNote.getState().session?.projectId === noteId);
    const { unsent } = binding.detach();
    roles.stop();
    handBack(reason, unsent);
  };
  const gone = () => shared !== null && (shared.phase === "detached" || shared.phase === "closed");
  const session: RemoteDocumentSession =
    shared ??
    new RemoteDocumentSession(path, request.baseline.text, {
      transport: (deps.transport ?? collabSessionTransport)(request.session.projectId),
      readOnly: () => !writable(),
      onDiscarded: (reason) => showNoteLiveNotice(request.noticeId ?? noteId, reason),
    });
  const stopPhase = session.subscribePhase((phase) => {
    if (phase === "detached" || (shared && phase === "closed")) end("dropped");
    else if (phase === "open") request.onOpen?.();
  });
  const binding = new NoteLiveBinding({
    session: shared ? liveView(shared, writable) : session,
    editor: surface,
    baseline: request.baseline.serialized,
    clock: deps.clock,
    onError: (error) => {
      void logError("live note", error);
      showNoteLiveNotice(request.noticeId ?? noteId, "refused");
    },
  });
  binding.start();
  if (shared && shared.text() !== request.baseline.text) binding.resync();
  const releaseComments = registerNoteCommentSurface({
    projectId: request.session.projectId,
    path,
    session,
    flush: () => {
      if (!ended) binding.flush();
    },
    show: (view) => {
      if (!ended) editor.setComments?.(view);
    },
    draft: () => (ended ? null : (editor.commentDraft?.() ?? null)),
    target: () => (ended ? null : (editor.commentTarget?.() ?? null)),
    reveal: (threadId) => !ended && (editor.revealComment?.(threadId) ?? false),
  });
  const presence = presenceFor(noteId, path, editor, deps.presence ?? tauriPresence);
  refreshMarks = presence.refresh;
  if (shared) {
    if (shared.phase === "open") request.onOpen?.();
  } else {
    void session.open();
  }
  const flush = async (waitMs: number) => {
    if (ended) return;
    binding.flush();
    await settledWithin([session], waitMs);
    if (!shared && session.unconfirmed) end("dropped");
  };
  const handle: NoteLiveHandle = {
    localChanged: () => binding.localChanged(),
    compositionEnd: () => binding.compositionEnd(),
    resync: () => binding.resync(),
    flush,
    end: () => end(),
  };
  entry.handle = handle;
  bound.add(entry);
  if (gone()) end("dropped");
  return handle;
}

export async function handBackNote(noteId: string, waitMs: number = NOTE_HAND_BACK_MS): Promise<void> {
  const held = [...bound.values()].filter((entry) => entry.noteId === noteId);
  await Promise.all(held.flatMap((entry) => (entry.handle ? [entry.handle.flush(waitMs)] : [])));
}

export function installNoteLive(deps: NoteLiveDeps = {}): () => void {
  return installNoteLivePort({ bind: (request) => bindNoteLive(request, deps), handBack: (noteId) => handBackNote(noteId) });
}
