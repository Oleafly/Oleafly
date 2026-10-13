import type { CollabLiveEndedReason, CollabLiveSyncState } from "@/lib/tauri";

export const SYNC_STATES = [
  "upToDate",
  "syncing",
  "offline",
  "reconnecting",
  "signedOut",
  "suspended",
  "accessEnded",
  "removed",
  "archived",
  "paused",
] as const;

export type SyncState = (typeof SYNC_STATES)[number];

const ENDED: Readonly<Record<CollabLiveEndedReason, SyncState>> = {
  removed: "removed",
  archived: "archived",
  signed_out: "signedOut",
  stopped: "paused",
  account_suspended: "suspended",
  access_ended: "accessEnded",
};

export function syncState(status: CollabLiveSyncState | null, pending: number): SyncState {
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
