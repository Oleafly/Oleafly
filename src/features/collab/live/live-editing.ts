import { getEditorDocumentPath, getEditorView, subscribeEditorDocument } from "@oleafly/editor";
import { setCollabEditorExtension } from "@/components/editor/cm/collab-slot";
import { installCollabEditorPort, useCollabEditorGate } from "@/lib/collab-live-bridge";
import { logError } from "@/lib/log";
import { collabDocChange, collabDocClose, collabDocOpen, collabLiveFlush, collabPresenceSet } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { LiveSessions } from "./live-sessions";
import { type LivePeer, type LiveSession, useCollabLiveStore } from "./live-store";
import { createPresencePublisher, type Presence } from "./presence";
import { type RemoteCursor, remoteCursors } from "./remote-cursors";

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

function mirrorText(projectId: string, path: string, text: string): void {
  useFilesStore.setState((state) => {
    const file = state.files[path];
    if (state.projectId !== projectId || !file || file.dirty || file.content === text) return state;
    return { files: { ...state.files, [path]: { ...file, content: text } } };
  });
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
  const uninstallPort = installCollabEditorPort({
    documentSession: (path) =>
      useFilesStore.getState().projectId === projectId ? sessions.documentSession(path) : null,
    flush: (id) => (id === projectId ? sessions.flush(() => collabLiveFlush(projectId)) : Promise.resolve()),
  });
  useCollabEditorGate.setState({ projectId, viewer: isViewer() });
  const unsubscribeRole = useCollabLiveStore.subscribe((state, previous) => {
    if (state.role !== previous.role) useCollabEditorGate.setState({ viewer: state.role === "viewer" });
  });

  const presence = createPresencePublisher(
    () => currentPresence(projectId),
    ({ path, cursor, anchor }) => {
      void collabPresenceSet(projectId, path, cursor, anchor).catch((error) => logError("collab presence", error));
    },
  );
  const unsubscribeActive = useFilesStore.subscribe((state, previous) => {
    if (state.activePath !== previous.activePath) presence.schedule();
  });
  const releaseCursors = setCollabEditorExtension(
    remoteCursors({
      cursors: () => peerCursors(useCollabLiveStore.getState().peers, getEditorDocumentPath()),
      subscribe: (listener) => {
        const stopPeers = useCollabLiveStore.subscribe((state, previous) => {
          if (state.peers !== previous.peers) listener();
        });
        const stopDocument = subscribeEditorDocument(() => listener());
        return () => {
          stopPeers();
          stopDocument();
        };
      },
      activity: () => presence.schedule(),
    }),
  );
  presence.schedule();
  useFilesStore.getState().bumpDocVersion();

  return () => {
    presence.dispose();
    unsubscribeActive();
    unsubscribeRole();
    releaseCursors();
    uninstallPort();
    sessions.close();
    useCollabEditorGate.setState({ projectId: null, viewer: false });
    const files = useFilesStore.getState();
    if (files.projectId === projectId) files.bumpDocVersion();
  };
}
