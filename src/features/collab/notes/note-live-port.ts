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
  showNoteLiveNotice,
  useCollabLiveNote,
} from "@/lib/collab-live-bridge";
import { logError } from "@/lib/log";
import { collabPresenceLeave, collabPresenceSet } from "@/lib/tauri-collab";
import type { CollabProjectRole } from "@/lib/tauri";
import { settledWithin } from "../live/live-sessions";
import { type LivePeer, useCollabLiveStore } from "../live/live-store";
import { createPresencePublisher, inOrder, peerCursors } from "../live/presence";
import { RemoteDocumentSession, type RemoteSessionTransport } from "../live/remote-session";
import { collabSessionTransport } from "../live/transport";
import { canEditProjectRole } from "../roles";
import { NoteLiveBinding, type NoteLiveClock } from "./note-live";

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
  for (const waiter of [...jumperWaiters]) waiter();
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
  selfId: string | null,
  path: string,
  blockAt: (offset: number) => number,
  unknownName: string,
): NotePeerMark[] {
  const marks: NotePeerMark[] = [];
  const seen = new Set<string>();
  for (const peer of Object.values(peers)) {
    if (peer.accountId === selfId || peer.path !== path || peer.cursor === null) continue;
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
  const publisher = createPresencePublisher(
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
  const unknownName = () => i18n.t(($) => $.notes.live.someone);
  const marks = (selfId: string | null) => {
    const state = useCollabLiveStore.getState();
    return state.projectId === noteId ? peerMarksFor(state.peers, selfId, path, editor.blockAt, unknownName()) : [];
  };
  let applied = 0;
  const reports = new Map<string, { head: number; anchor: number; applied: number }>();
  const refresh = (remoteEdit = false) => {
    const state = useCollabLiveStore.getState();
    editor.setPeerMarks(marks(state.share?.account_id ?? null));
    const carets = state.projectId === noteId ? peerCaretsFor(state.peers, path) : [];
    if (remoteEdit) applied += 1;
    const replace = new Set<string>();
    for (const caret of carets) {
      const seen = reports.get(caret.id);
      if (!seen || seen.head !== caret.head || seen.anchor !== caret.anchor) {
        reports.set(caret.id, { head: caret.head, anchor: caret.anchor, applied });
      } else if (remoteEdit && seen.applied === applied - 1) {
        replace.add(caret.id);
        reports.set(caret.id, { ...seen, applied });
      }
    }
    editor.setPeerCarets(carets, replace);
  };
  let deferred: ReturnType<typeof setTimeout> | null = null;
  const stopCaret = editor.onCaret(() => {
    if (deferred !== null) return;
    deferred = setTimeout(() => {
      deferred = null;
      publisher.schedule();
    }, 0);
  });
  const unsubscribe = useCollabLiveStore.subscribe((state, previous) => {
    if (state.peers !== previous.peers || state.projectId !== previous.projectId) refresh();
  });
  const jump = (accountId: string) => {
    const mark = marks(null).find((entry) => entry.id === accountId);
    if (mark) editor.revealBlock(mark.index);
  };
  setJumper(key, jump);
  publisher.schedule();
  refresh();
  return {
    refresh,
    dispose: (leave: boolean) => {
      publisher.dispose();
      stopCaret();
      if (deferred !== null) clearTimeout(deferred);
      unsubscribe();
      if (jumpers.get(key) === jump) jumpers.delete(key);
      editor.setPeerMarks([]);
      editor.setPeerCarets([]);
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

export function bindNoteLive(request: NoteLiveBindRequest, deps: NoteLiveDeps = {}): NoteLiveHandle {
  const { noteId, path, editor } = request;
  const roles = roleTracker(noteId, request.session.role);
  const releaseHold = holdNoteLivePath(request.session.projectId, path);
  let ended = false;
  const entry: BoundNote = { noteId, handle: null };
  let refreshMarks: (remoteEdit: boolean) => void = () => {};
  const surface = {
    serialize: () => editor.serialize(),
    composing: () => editor.composing(),
    show: (previous: string, next: string, keepLocal: boolean) => {
      editor.show(previous, next, keepLocal);
      refreshMarks(true);
    },
  };
  const end = (reason: NoteLiveEndReason = "released") => {
    if (ended) return;
    ended = true;
    bound.delete(entry);
    releaseHold();
    refreshMarks = () => {};
    presence.dispose(!boundElsewhere(entry) && useCollabLiveNote.getState().session?.projectId === noteId);
    const { unsent } = binding.detach();
    let base: string;
    try {
      base = session.confirmed();
    } catch {
      base = session.text();
    }
    const edited = unsent || session.unconfirmed;
    const text = session.text();
    session.close();
    roles.stop();
    request.onEnd({ text, base, edited, reason });
  };
  const session: RemoteDocumentSession = new RemoteDocumentSession(path, request.baseline.text, {
    transport: (deps.transport ?? collabSessionTransport)(request.session.projectId),
    readOnly: () => !canEditProjectRole(roles.role()),
    onPhase: (phase) => {
      if (phase === "detached") end("dropped");
    },
    onDiscarded: (reason) => showNoteLiveNotice(noteId, reason),
  });
  const binding = new NoteLiveBinding({
    session,
    editor: surface,
    baseline: request.baseline.serialized,
    clock: deps.clock,
    onError: (error) => void logError("live note", error),
  });
  binding.start();
  const presence = presenceFor(noteId, path, editor, deps.presence ?? tauriPresence);
  refreshMarks = presence.refresh;
  void session.open();
  const flush = async (waitMs: number) => {
    if (ended) return;
    binding.flush();
    await settledWithin([session], waitMs);
    if (session.unconfirmed) end("dropped");
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
  return handle;
}

export async function handBackNote(noteId: string, waitMs: number = NOTE_HAND_BACK_MS): Promise<void> {
  const held = [...bound.values()].filter((entry) => entry.noteId === noteId);
  await Promise.all(held.map((entry) => entry.handle?.flush(waitMs)));
}

export function installNoteLive(deps: NoteLiveDeps = {}): () => void {
  return installNoteLivePort({ bind: (request) => bindNoteLive(request, deps), handBack: (noteId) => handBackNote(noteId) });
}
