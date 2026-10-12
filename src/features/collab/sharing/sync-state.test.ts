import { describe, expect, it } from "vitest";
import type { CollabLiveState } from "@/lib/tauri";
import { SYNC_STATES, syncState } from "./sync-state";

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

  it("names every state once", () => {
    expect(new Set(SYNC_STATES).size).toBe(SYNC_STATES.length);
  });
});
