import { getEditorDocumentPath, getEditorView, subscribeEditorDocument } from "@oleafly/editor";
import { setCollabEditorExtension } from "@/components/editor/cm/collab-slot";
import { installCollabEditorPort, useCollabEditorGate } from "@/lib/collab-live-bridge";
import { logError } from "@/lib/log";
import {
  collabDocChange,
  collabDocClose,
  collabDocOpen,
  collabLiveFlush,
  collabPresenceLeave,
  collabPresenceSet,
} from "@/lib/tauri";
import { onPathsDeleted, onPathsMoved, useFilesStore } from "@/store/files";
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
  const isViewer = () => useCollabLiveStore.getState().role === "viewer";
  const sessions = new LiveSessions({
    transport: {
      open: (path, onMessage) => collabDocOpen(projectId, path, onMessage),
      change: (fileId, rev, op) => collabDocChange(projectId, fileId, rev, op),
      close: (fileId) => collabDocClose(projectId, fileId),
    },
    readOnly: isViewer,
    initialText: (path) => {
      const files = useFilesStore.getState();
      return files.projectId === projectId ? (files.files[path]?.content ?? null) : null;
    },
    mirror: (path, text) => mirrorText(projectId, path, text),
    detached: (path, text, edited) => {
      const files = useFilesStore.getState();
      if (files.projectId !== projectId) return;
      if (edited) files.setContent(path, text);
      if (files.activePath === path) files.bumpDocVersion();
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
    flush: (id) => (id === projectId ? sessions.flush(() => collabLiveFlush(projectId)) : Promise.resolve()),
  });
  useCollabEditorGate.setState({ projectId, viewer: isViewer(), connecting: false });
  const unsubscribeRole = useCollabLiveStore.subscribe((state, previous) => {
    if (state.role !== previous.role) useCollabEditorGate.setState({ viewer: state.role === "viewer" });
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
  const unsubscribeVisibility = useSettingsStore.subscribe((state, previous) => {
    if (state.collabPresence !== previous.collabPresence) presence.schedule();
  });
  const releaseCursors = setCollabEditorExtension(remoteCursors(peerCursorSource(() => presence.schedule())));
  presence.schedule();
  useFilesStore.getState().bumpDocVersion();

  return () => {
    presence.dispose();
    unsubscribeActive();
    unsubscribeVisibility();
    unsubscribeRole();
    releaseCursors();
    stopMoves();
    stopDeletes();
    uninstallPort();
    sessions.close();
    useCollabEditorGate.setState({ projectId: null, viewer: false, connecting: false });
    const files = useFilesStore.getState();
    if (files.projectId === projectId) files.bumpDocVersion();
  };
}
