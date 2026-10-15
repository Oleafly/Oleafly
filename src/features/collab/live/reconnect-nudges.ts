import { logError } from "@/lib/log";
import { collabLiveReconnectNow } from "@/lib/tauri";

// After a long outage the live session waits up to a minute between tries.
// When the network comes back, or the laptop wakes and the window shows
// again after a while, it is told to try at once instead.
export const HIDDEN_LONG_MS = 30_000;
export const NUDGE_GAP_MS = 5_000;

export function startReconnectNudges(): () => void {
  let last = Number.NEGATIVE_INFINITY;
  let hiddenSince: number | null = document.visibilityState === "hidden" ? Date.now() : null;

  const nudge = () => {
    const now = Date.now();
    if (now - last < NUDGE_GAP_MS) return;
    last = now;
    collabLiveReconnectNow().catch((error: unknown) => logError("collab reconnect now", error));
  };

  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      hiddenSince ??= Date.now();
      return;
    }
    const since = hiddenSince;
    hiddenSince = null;
    if (since !== null && Date.now() - since >= HIDDEN_LONG_MS) nudge();
  };

  window.addEventListener("online", nudge);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.removeEventListener("online", nudge);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
