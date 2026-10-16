export interface Presence {
  path: string | null;
  cursor: number | null;
  anchor: number | null;
}

export const PRESENCE_INTERVAL_MS = 150;
export const PRESENCE_KEEP_ALIVE_MS = 15_000;

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
  const keepAlive = setInterval(() => {
    if (!disposed && lastSent !== null) send(lastSent);
  }, PRESENCE_KEEP_ALIVE_MS);

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
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
