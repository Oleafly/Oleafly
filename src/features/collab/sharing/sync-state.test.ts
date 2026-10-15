import { describe, expect, it } from "vitest";
import type { CollabLiveEndedReason, CollabLiveState, CollabLiveSyncState } from "@/lib/tauri";
import { heldStatus, SYNC_STATES, syncState } from "./sync-state";

describe("syncState", () => {
  it.each<[CollabLiveState | null, number, (typeof SYNC_STATES)[number]]>([
    [{ state: "online" }, 0, "upToDate"],
    [{ state: "online" }, 3, "syncing"],
    [{ state: "connecting" }, 0, "syncing"],
    [{ state: "offline", retry_in_ms: 2000 }, 47, "offline"],
    [{ state: "offline", retry_in_ms: 2000 }, 0, "reconnecting"],
    [{ state: "ended", reason: "signed_out" }, 0, "signedOut"],
    [{ state: "ended", reason: "removed" }, 2, "removed"],
    [{ state: "ended", reason: "archived" }, 0, "archived"],
    [{ state: "ended", reason: "stopped" }, 0, "paused"],
    [null, 0, "syncing"],
  ])("reads %j with %i waiting as %s", (status, pending, expected) => {
    expect(syncState(status, pending)).toBe(expected);
  });

  it.each<[CollabLiveEndedReason, (typeof SYNC_STATES)[number]]>([
    ["account_suspended", "suspended"],
    ["access_ended", "accessEnded"],
    ["server_removed", "serverRemoved"],
    ["client_too_old", "clientTooOld"],
    ["server_too_old", "serverTooOld"],
    ["server_changed", "serverChanged"],
  ])("reads a session that ended with %s as %s", (reason, expected) => {
    const status: CollabLiveSyncState = { state: "ended", reason };
    expect(syncState(status, 0)).toBe(expected);
  });

  it("names every state once", () => {
    expect(new Set(SYNC_STATES).size).toBe(SYNC_STATES.length);
  });

  it("keeps an offline status through a reconnect attempt and lets any other status through", () => {
    const offline: CollabLiveSyncState = { state: "offline", retry_in_ms: 2000 };
    const connecting: CollabLiveSyncState = { state: "connecting" };
    const online: CollabLiveSyncState = { state: "online" };
    const ended: CollabLiveSyncState = { state: "ended", reason: "removed" };
    expect(heldStatus(offline, connecting)).toBe(offline);
    expect(heldStatus(null, connecting)).toBe(connecting);
    expect(heldStatus(online, connecting)).toBe(connecting);
    expect(heldStatus(offline, online)).toBe(online);
    expect(heldStatus(offline, ended)).toBe(ended);
    const later: CollabLiveSyncState = { state: "offline", retry_in_ms: 5000 };
    expect(heldStatus(offline, later)).toBe(later);
  });
});
