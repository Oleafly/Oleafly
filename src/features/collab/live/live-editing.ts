import { getEditorDocumentPath, getEditorView, subscribeEditorDocument } from "@oleafly/editor";
import { setCollabEditorExtension } from "@/components/editor/cm/collab-slot";
import { installCollabEditorPort, useCollabEditorGate } from "@/lib/collab-live-bridge";
import { i18n } from "@/i18n";
import { logError } from "@/lib/log";
import { toast } from "@/lib/toast";
import {
  collabDocChange,
  collabDocClose,
  collabDocOpen,
  collabLiveFlush,
  collabPresenceLeave,
  collabPresenceSet,
} from "@/lib/tauri-collab";
import { isProjectIntelligencePath } from "@/lib/project-intelligence/source";
import { onPathsDeleted, onPathsMoved, useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { isReadOnlyProjectRole } from "../roles";
import { useSettingsStore } from "@/store/settings";
import { LiveSessions } from "./live-sessions";
import { type LivePeer, type LiveSession, useCollabLiveStore } from "./live-store";
import { createPresencePublisher, type Presence, visiblePresence } from "./presence";
import { type RemoteCursor, type RemoteCursorSource, remoteCursors } from "./remote-cursors";

export function peerCursors(peers: Record<string, LivePeer>, path: string | null): RemoteCursor[] {
  if (!path) return [];
  const cursors: RemoteCursor[] = [];
  for (const peer of Object.values(peers)) {
    if (peer.path !== path || peer.cursor === null) continue;
    cursors.push({
      id: peer.deviceId,
      name: peer.person?.display_name ?? null,
      hue: peer.hue,
      head: peer.cursor,
      anchor: peer.anchor ?? peer.cursor,
    });
  }
  return cursors;
}

function sameCursors(a: readonly RemoteCursor[], b: readonly RemoteCursor[]): boolean {
  return (
    a.length === b.length &&
    a.every((cursor, index) => {
      const other = b[index];
      return (
        cursor.id === other.id &&
        cursor.name === other.name &&
        cursor.hue === other.hue &&
        cursor.head === other.head &&
        cursor.anchor === other.anchor
      );
    })
  );
}

function peerCursorSource(activity: () => void): RemoteCursorSource {
  return {
    cursors: () => peerCursors(useCollabLiveStore.getState().peers, getEditorDocumentPath()),
    subscribe: (listener) => {
      const stopPeers = useCollabLiveStore.subscribe((state, previous) => {
        if (state.peers === previous.peers) return;
        const path = getEditorDocumentPath();
        if (!sameCursors(peerCursors(state.peers, path), peerCursors(previous.peers, path))) listener();
      });
      const stopDocument = subscribeEditorDocument(() => listener());
      return () => {
        stopPeers();
        stopDocument();
      };
    },
    activity,
  };
}

function mirrorText(projectId: string, path: string, text: string): void {
  useFilesStore.setState((state) => {
    const file = state.files[path];
    if (state.projectId !== projectId || !file || file.dirty || file.content === text) return state;
    return { files: { ...state.files, [path]: { ...file, content: text } } };
  });
}

export const BACKGROUND_INDEX_MS = 400;
// How long a project that is closing waits for the shared document to take
// typing in flight before it hands that typing back to the files store.
export const HAND_BACK_WAIT_MS = 1_500;

// A collaborator's edit to a shared file in a background tab reaches the
// store through the session, but the index keeper forwards only the active
// file, and Rust doesn't report a file it writes while an editor has it open.
// Without this a label or a bibliography entry someone adds there stays
// unknown to completion and reference checks until the file is opened. At
// most one update per file runs in each interval, with the text it has then.
function backgroundIndexer(projectId: string) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const run = (path: string) => {
    timers.delete(path);
    const files = useFilesStore.getState();
    const file = files.files[path];
    if (files.projectId !== projectId || files.activePath === path || !file) return;
    useIndexStore.getState().updateFile(path, file.content);
  };
  return {
    schedule(path: string): void {
      if (timers.has(path) || !isProjectIntelligencePath(path)) return;
      const files = useFilesStore.getState();
      if (files.projectId !== projectId || files.activePath === path) return;
      timers.set(path, setTimeout(() => run(path), BACKGROUND_INDEX_MS));
    },
    dispose(): void {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}

function inOrder(): (call: () => Promise<void>) => void {
  let last = Promise.resolve();
  return (call) => {
    last = last.then(call).catch((error) => logError("collab presence", error));
  };
}

function currentPresence(projectId: string): Presence {
  const files = useFilesStore.getState();
  const path = files.projectId === projectId ? files.activePath : null;
  const view = getEditorView();
  if (!path || !view || getEditorDocumentPath() !== path) return { path, cursor: null, anchor: null };
  const { head, anchor } = view.state.selection.main;
  return { path, cursor: head, anchor };
}

export function startLiveEditing(live: LiveSession): () => void {
  const { projectId } = live;
  const isViewer = () => isReadOnlyProjectRole(useCollabLiveStore.getState().role);
  const indexer = backgroundIndexer(projectId);
  const sessions = new LiveSessions({
    transport: {
      open: (path, onMessage) => collabDocOpen(projectId, path, onMessage),
      change: (fileId, rev, op) => collabDocChange(projectId, fileId, rev, op),
      close: (fileId, session) => collabDocClose(projectId, fileId, session),
    },
    readOnly: isViewer,
    initialText: (path) => {
      const files = useFilesStore.getState();
      return files.projectId === projectId ? (files.files[path]?.content ?? null) : null;
    },
    mirror: (path, text) => {
      mirrorText(projectId, path, text);
      indexer.schedule(path);
    },
    detached: (path, text, edited, shared) => {
      const files = useFilesStore.getState();
      if (files.projectId !== projectId) return;
      // The mirror already put this text in the buffer as saved, so say it
      // isn't, or the typing would never reach the disk. Merging from the text
      // Rust confirmed sends a project that is still live exactly the typing
      // it never got.
      if (edited) files.setContent(path, text, { unsaved: true, base: shared });
      if (files.activePath === path) files.bumpDocVersion();
    },
    shown: (path) => {
      const files = useFilesStore.getState();
      return files.projectId === projectId && (files.openTabs.includes(path) || files.activePath === path);
    },
    discarded: (path, reason) => {
      toast.info(
        reason === "read_only"
          ? i18n.t(($) => $.collab.access.unsentReadOnly, { path })
          : i18n.t(($) => $.collab.access.unsentRefused, { path }),
      );
    },
  });
  const stopMoves = onPathsMoved((moved) => {
    if (moved.projectId === projectId) sessions.move(moved.from, moved.to);
  });
  const stopDeletes = onPathsDeleted((deleted) => {
    if (deleted.projectId === projectId) sessions.forget(deleted.path);
  });
  const uninstallPort = installCollabEditorPort({
    documentSession: (path) =>
      useFilesStore.getState().projectId === projectId ? sessions.documentSession(path) : null,
    holds: (path) => useFilesStore.getState().projectId === projectId && sessions.holds(path),
    // A compile reads figures too, so this flush waits for ones still
    // downloading.
    flush: (id) =>
      id === projectId
        ? sessions.flush(() => collabLiveFlush(projectId, { waitForFigures: true }))
        : Promise.resolve(),
    handBack: (id) => (id === projectId ? sessions.handBack(HAND_BACK_WAIT_MS) : Promise.resolve()),
  });
  useCollabEditorGate.setState({ projectId, viewer: isViewer(), connecting: false });
  const unsubscribeRole = useCollabLiveStore.subscribe((state, previous) => {
    if (state.role !== previous.role) useCollabEditorGate.setState({ viewer: isReadOnlyProjectRole(state.role) });
  });

  const queue = inOrder();
  const presence = createPresencePublisher(
    () => visiblePresence(currentPresence(projectId), useSettingsStore.getState().collabPresence),
    ({ path, cursor, anchor }) => queue(() => collabPresenceSet(projectId, path, cursor, anchor)),
    () => queue(() => collabPresenceLeave(projectId)),
  );
  const unsubscribeActive = useFilesStore.subscribe((state, previous) => {
    if (state.activePath !== previous.activePath) presence.schedule();
  });
  const unsubscribeTabs = useFilesStore.subscribe((state, previous) => {
    if (state.openTabs === previous.openTabs || state.projectId !== projectId) return;
    for (const path of previous.openTabs) {
      if (!state.openTabs.includes(path)) sessions.release(path);
    }
  });
  const unsubscribeVisibility = useSettingsStore.subscribe((state, previous) => {
    if (state.collabPresence !== previous.collabPresence) presence.schedule();
  });
  const releaseCursors = setCollabEditorExtension(remoteCursors(peerCursorSource(() => presence.schedule())));
  presence.schedule();
  useFilesStore.getState().bumpDocVersion();

  return () => {
    presence.dispose();
    unsubscribeActive();
    unsubscribeTabs();
    unsubscribeVisibility();
    unsubscribeRole();
    releaseCursors();
    stopMoves();
    stopDeletes();
    uninstallPort();
    sessions.close();
    indexer.dispose();
    useCollabEditorGate.setState({ projectId: null, viewer: false, connecting: false });
    const files = useFilesStore.getState();
    if (files.projectId === projectId) files.bumpDocVersion();
  };
}
