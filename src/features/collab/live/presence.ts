import { logError } from "@/lib/log";
import type { LivePeer } from "./live-store";

export interface Presence {
  path: string | null;
  cursor: number | null;
  anchor: number | null;
}

export const PRESENCE_INTERVAL_MS = 150;
export const PRESENCE_KEEP_ALIVE_MS = 15_000;
export const PRESENCE_ANNOUNCE_JITTER_MS = 250;

const peerJoinedListeners = new Set<() => void>();

export function announcePeerJoined(): void {
  for (const listener of peerJoinedListeners) listener();
}

export interface PresencePublisher {
  schedule(): void;
  dispose(): void;
}

const sameAs = (a: Presence | null, b: Presence) =>
  a !== null && a.path === b.path && a.cursor === b.cursor && a.anchor === b.anchor;

export function createPresencePublisher(
  read: () => Presence | null,
  send: (presence: Presence) => void,
  leave: () => void,
): PresencePublisher {
  let lastAt = Number.NEGATIVE_INFINITY;
  let lastSent: Presence | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let announce: ReturnType<typeof setTimeout> | null = null;
  const keepAlive = setInterval(() => {
    if (!disposed && lastSent !== null) send(lastSent);
  }, PRESENCE_KEEP_ALIVE_MS);
  const onPeerJoined = () => {
    if (disposed || lastSent === null || announce !== null) return;
    announce = setTimeout(() => {
      announce = null;
      if (!disposed && lastSent !== null) send(lastSent);
    }, Math.floor(Math.random() * PRESENCE_ANNOUNCE_JITTER_MS));
  };
  peerJoinedListeners.add(onPeerJoined);

  const publish = () => {
    timer = null;
    if (disposed) return;
    lastAt = Date.now();
    const presence = read();
    if (presence === null) {
      if (lastSent === null) return;
      lastSent = null;
      leave();
      return;
    }
    if (sameAs(lastSent, presence)) return;
    lastSent = presence;
    send(presence);
  };

  return {
    schedule: () => {
      if (disposed || timer !== null) return;
      const wait = lastAt + PRESENCE_INTERVAL_MS - Date.now();
      if (wait <= 0) publish();
      else timer = setTimeout(publish, wait);
    },
    dispose: () => {
      disposed = true;
      clearInterval(keepAlive);
      peerJoinedListeners.delete(onPeerJoined);
      if (announce !== null) clearTimeout(announce);
      announce = null;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

export interface PeerCursor {
  id: string;
  name: string | null;
  hue: number;
  head: number;
  anchor: number;
}

export function peerCursors(peers: Readonly<Record<string, LivePeer>>, path: string | null): PeerCursor[] {
  if (!path) return [];
  const cursors: PeerCursor[] = [];
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

export function inOrder(scope: string): (call: () => Promise<void>) => void {
  let last = Promise.resolve();
  return (call) => {
    last = last.then(call).catch((error: unknown) => logError(scope, error));
  };
}
