import { getEditorDocumentPath, getEditorView, scrollEditorPositionLocally } from "@oleafly/editor";
import { noteLiveHolds } from "@/lib/collab-live-bridge";
import { openProjectLocation, type ProjectLocation } from "@/lib/open-location";
import { isProjectNotePath } from "@/lib/project-notes";
import { isBinaryProjectPath } from "@/lib/project-paths";
import { jumpToNotePeerWhenBound } from "../notes/note-live-port";
import { type LivePeer, useCollabLiveStore } from "./live-store";
import { flashRemoteCursor, remoteCursorsIn } from "./remote-cursors";

const MOST_FOLLOWS = 3;

interface Whereabouts {
  deviceId: string;
  path: string;
  cursor: number | null;
}

export function whereIs(peers: Readonly<Record<string, LivePeer>>, accountId: string): Whereabouts | null {
  let latest: LivePeer | null = null;
  for (const peer of Object.values(peers)) {
    if (peer.accountId !== accountId || !peer.path) continue;
    if (!latest || peer.seenAt > latest.seenAt) latest = peer;
  }
  return latest?.path ? { deviceId: latest.deviceId, path: latest.path, cursor: latest.cursor } : null;
}

function locationOf(place: Whereabouts): ProjectLocation {
  if (place.cursor === null || isBinaryProjectPath(place.path)) return { path: place.path };
  return { path: place.path, range: { from: place.cursor, to: place.cursor } };
}

async function showCaret(place: Whereabouts, accountId: string): Promise<void> {
  const projectId = useCollabLiveStore.getState().projectId;
  if (projectId !== null && getEditorDocumentPath() !== place.path) {
    if (noteLiveHolds(projectId, place.path) || isProjectNotePath(place.path)) {
      await jumpToNotePeerWhenBound(projectId, place.path, accountId);
      return;
    }
  }
  const view = getEditorView();
  if (!view || place.cursor === null || getEditorDocumentPath() !== place.path) return;
  const mapped = remoteCursorsIn(view.state).find((cursor) => cursor.id === place.deviceId);
  scrollEditorPositionLocally(view, mapped?.head ?? place.cursor);
  flashRemoteCursor(view, place.deviceId);
}

let latestJump = 0;

export async function goToPerson(accountId: string): Promise<boolean> {
  const jump = ++latestJump;
  let opened: string | null = null;
  for (let follows = 0; follows <= MOST_FOLLOWS; follows += 1) {
    const place = whereIs(useCollabLiveStore.getState().peers, accountId);
    if (!place) return opened !== null;
    if (place.path === opened) {
      await showCaret(place, accountId);
      return true;
    }
    if (!(await openProjectLocation(locationOf(place), { keepSelection: true }))) return false;
    if (jump !== latestJump) return false;
    opened = place.path;
  }
  return opened !== null;
}
