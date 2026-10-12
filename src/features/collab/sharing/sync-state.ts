import type { CollabLiveEndReason, CollabLiveState } from "@/lib/tauri";

export const SYNC_STATES = [
  "upToDate",
  "syncing",
  "offline",
  "reconnecting",
  "signedOut",
  "removed",
  "archived",
  "paused",
] as const;

export type SyncState = (typeof SYNC_STATES)[number];

const ENDED: Readonly<Record<CollabLiveEndReason, SyncState>> = {
  removed: "removed",
  archived: "archived",
  signed_out: "signedOut",
  stopped: "paused",
};

export function syncState(status: CollabLiveState | null, pending: number): SyncState {
  if (status === null) return "syncing";
  switch (status.state) {
    case "connecting":
      return "syncing";
    case "online":
      return pending > 0 ? "syncing" : "upToDate";
    case "offline":
      return pending > 0 ? "offline" : "reconnecting";
    case "ended":
      return ENDED[status.reason];
  }
}
