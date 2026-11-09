import { getEditorDocumentPath, getEditorView, subscribeEditorDocument } from "@oleafly/editor";
import { setCollabEditorExtension } from "@/components/editor/cm/collab-slot";
import {
  installCollabEditorPort,
  noteLiveHolds,
  onNoteLiveHoldsChange,
  useCollabEditorGate,
} from "@/lib/collab-live-bridge";
import { i18n } from "@/i18n";
import { mirrorFileText } from "@/lib/live-file-mirror";
import { logError } from "@/lib/log";
import { toast } from "@/lib/toast";
import {
  collabLiveFlush,
  collabPresenceLeave,
  collabPresenceSet,
  onCollabSuggestionRefused,
} from "@/lib/tauri-collab";
import type { CollabErrorCode } from "@/lib/tauri";
import { isProjectIntelligencePath } from "@/lib/project-intelligence/source";
import { onPathsDeleted, onPathsMoved, useFilesStore } from "@/store/files";
import { useIndexStore } from "@/store/project-index";
import { collabErrorMessage } from "../errors";
import { canEditProjectRole, isReadOnlyProjectRole } from "../roles";
import { LiveSessions } from "./live-sessions";
import { type LiveSession, useCollabLiveStore } from "./live-store";
import { createPresencePublisher, inOrder, type Presence, peerCursors } from "./presence";
import { type RemoteCursor, type RemoteCursorSource, remoteCursors } from "./remote-cursors";
import { collabSessionTransport } from "./transport";

export { peerCursors };

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

export const BACKGROUND_INDEX_MS = 400;
export const HAND_BACK_WAIT_MS = 1_500;
export const REFUSAL_FRESH_MS = 10_000;

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
  const refusals = new Map<string, { code: CollabErrorCode; at: number }>();
  const stopRefusals = onCollabSuggestionRefused((refused) => {
    if (refused.projectId === projectId) refusals.set(refused.path, { code: refused.code, at: Date.now() });
  }).catch((error: unknown) => {
    void logError("collab suggestion refusals listen", error);
    return () => undefined;
  });
  const sessions = new LiveSessions({
    transport: collabSessionTransport(projectId),
    readOnly: isViewer,
    initialText: (path) => {
      const files = useFilesStore.getState();
      return files.projectId === projectId ? (files.files[path]?.content ?? null) : null;
    },
    mirror: (path, text) => {
      mirrorFileText(projectId, path, text);
      indexer.schedule(path);
    },
    detached: (path, text, edited, shared) => {
      const files = useFilesStore.getState();
      if (files.projectId !== projectId) return;
      if (edited) files.setContent(path, text, { unsaved: true, base: shared });
      if (files.activePath === path) files.bumpDocVersion();
    },
    shown: (path) => {
      const files = useFilesStore.getState();
      return files.projectId === projectId && (files.openTabs.includes(path) || files.activePath === path);
    },
    discarded: (path, reason) => {
      const refusal = refusals.get(path);
      refusals.delete(path);
      if (reason === "refused" && refusal && Date.now() - refusal.at < REFUSAL_FRESH_MS) {
        toast.info(collabErrorMessage(refusal.code));
        return;
      }
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
    flush: (id) =>
      id === projectId
        ? sessions.flush(() => collabLiveFlush(projectId, { waitForFigures: true }))
        : Promise.resolve(),
    handBack: (id) => (id === projectId ? sessions.handBack(HAND_BACK_WAIT_MS) : Promise.resolve()),
  });
  const isLocked = () => !canEditProjectRole(useCollabLiveStore.getState().role);
  useCollabEditorGate.setState({ projectId, viewer: isViewer(), locked: isLocked(), connecting: false });
  const unsubscribeRole = useCollabLiveStore.subscribe((state, previous) => {
    if (state.role !== previous.role) {
      useCollabEditorGate.setState({
        viewer: isReadOnlyProjectRole(state.role),
        locked: !canEditProjectRole(state.role),
      });
    }
  });

  const queue = inOrder("collab presence");
  let deferred = false;
  const presence = createPresencePublisher(
    () => currentPresence(projectId),
    ({ path, cursor, anchor }) => {
      deferred = noteLiveHolds(projectId, path);
      if (!deferred) queue(() => collabPresenceSet(projectId, path, cursor, anchor));
    },
    () => queue(() => collabPresenceLeave(projectId)),
  );
  let held = false;
  const stopNoteHolds = onNoteLiveHoldsChange(() => {
    const { path, cursor, anchor } = currentPresence(projectId);
    const wasHeld = held;
    held = noteLiveHolds(projectId, path);
    if (held || (!deferred && !wasHeld)) return;
    deferred = false;
    queue(() => collabPresenceSet(projectId, path, cursor, anchor));
  });
  const unsubscribeActive = useFilesStore.subscribe((state, previous) => {
    if (state.activePath !== previous.activePath) presence.schedule();
  });
  const unsubscribeTabs = useFilesStore.subscribe((state, previous) => {
    if (state.openTabs === previous.openTabs || state.projectId !== projectId) return;
    for (const path of previous.openTabs) {
      if (!state.openTabs.includes(path)) sessions.release(path);
    }
  });
  const releaseCursors = setCollabEditorExtension(remoteCursors(peerCursorSource(() => presence.schedule())));
  presence.schedule();
  useFilesStore.getState().bumpDocVersion();

  return () => {
    presence.dispose();
    stopNoteHolds();
    unsubscribeActive();
    unsubscribeTabs();
    unsubscribeRole();
    releaseCursors();
    stopMoves();
    stopDeletes();
    uninstallPort();
    sessions.close();
    void stopRefusals.then((unlisten) => unlisten());
    indexer.dispose();
    useCollabEditorGate.setState({ projectId: null, viewer: false, locked: false, connecting: false });
    const files = useFilesStore.getState();
    if (files.projectId === projectId) files.bumpDocVersion();
  };
}
