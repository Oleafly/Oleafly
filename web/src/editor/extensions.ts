import type { Extension } from "@codemirror/state";
import { EditorView, type KeyBinding } from "@codemirror/view";
import { peerHue } from "@/features/collab/live/peer-hue";
import { type RemoteCursor, type RemoteCursorSource, remoteCursors } from "@/features/collab/live/remote-cursors";
import type { EditorBridge, ProjectActions } from "../controller";
import { useWeb, type WebState } from "../store";
import { type OverlaySource, overlayDecorations } from "./decorations";

/** Mod-s compiles, as saving does in the app; Mod-Shift-j shows the cursor's line in the PDF. */
export function webEditorKeymap(actions: Pick<ProjectActions, "compile" | "showInPdf">): KeyBinding[] {
  return [
    {
      key: "Mod-s",
      run: () => {
        actions.compile();
        return true;
      },
      preventDefault: true,
    },
    {
      key: "Mod-Shift-j",
      run: () => {
        void actions.showInPdf();
        return true;
      },
      preventDefault: true,
    },
  ];
}

export function peerCursors(state: WebState): RemoteCursor[] {
  const self = state.me?.accountId ?? null;
  const fileId = state.activeFileId;
  if (!fileId) return [];
  const cursors: RemoteCursor[] = [];
  for (const peer of state.peers) {
    if (peer.fileId !== fileId || peer.head === null) continue;
    const name = state.people[peer.accountId]?.name || peer.name || null;
    cursors.push({
      id: peer.deviceId,
      name,
      hue: peerHue(peer.accountId, self),
      head: peer.head,
      anchor: peer.anchor ?? peer.head,
    });
  }
  return cursors;
}

function cursorSource(): RemoteCursorSource {
  let cached: { peers: WebState["peers"]; fileId: string | null; people: WebState["people"]; cursors: RemoteCursor[] } | null =
    null;
  return {
    cursors: () => {
      const state = useWeb.getState();
      if (
        cached &&
        cached.peers === state.peers &&
        cached.fileId === state.activeFileId &&
        cached.people === state.people
      ) {
        return cached.cursors;
      }
      cached = { peers: state.peers, fileId: state.activeFileId, people: state.people, cursors: peerCursors(state) };
      return cached.cursors;
    },
    subscribe: (listener) =>
      useWeb.subscribe((state, previous) => {
        if (state.peers !== previous.peers || state.activeFileId !== previous.activeFileId || state.people !== previous.people) {
          listener();
        }
      }),
  };
}

export function overlaySource(bridge: EditorBridge): OverlaySource {
  return {
    activePath: () => useWeb.getState().activePath,
    snapshot: (path) => bridge.overlaysFor(path),
    self: () => useWeb.getState().me?.accountId ?? null,
    selected: () => {
      const state = useWeb.getState();
      return { thread: state.selectedThreadId, suggestion: state.selectedSuggestionId };
    },
    subscribe: (listener) => {
      const stopOverlays = bridge.subscribeOverlays(listener);
      const stopStore = useWeb.subscribe((state, previous) => {
        if (
          state.selectedThreadId !== previous.selectedThreadId ||
          state.selectedSuggestionId !== previous.selectedSuggestionId ||
          state.activePath !== previous.activePath
        ) {
          listener();
        }
      });
      return () => {
        stopOverlays();
        stopStore();
      };
    },
    pick: (kind, id) =>
      useWeb.setState(
        kind === "thread"
          ? { selectedThreadId: id, selectedSuggestionId: null, side: "comments", discussion: "comments" }
          : { selectedSuggestionId: id, selectedThreadId: null, side: "comments", discussion: "comments" },
      ),
  };
}

export function webEditorExtensions(bridge: EditorBridge): Extension[] {
  return [
    overlayDecorations(overlaySource(bridge)),
    remoteCursors(cursorSource()),
    EditorView.updateListener.of((update) => {
      if (!update.selectionSet && !update.docChanged) return;
      const main = update.state.selection.main;
      bridge.selectionChanged(main.anchor, main.head);
    }),
  ];
}
