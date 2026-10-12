import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CollabSyncPaused, CollabSyncResumed } from "./tauri";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke, Channel: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

import * as tauri from "./tauri";

beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue(undefined);
  mocks.listen.mockReset().mockResolvedValue(mocks.unlisten);
});

describe("outside change decision bridge", () => {
  it.each([
    ["send", "send"],
    ["keep_local", "keep_local"],
  ] as const)("sends the %s decision to the resume command", async (decision, sent) => {
    await tauri.collabSyncDecide("paper", decision);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("collab_sync_resume", {
      projectId: "paper",
      decision: sent,
    });
  });

  it("forwards paused and resumed events with their payloads", async () => {
    const paused: CollabSyncPaused[] = [];
    const resumed: CollabSyncResumed[] = [];
    const stopPaused = await tauri.onCollabSyncPaused((payload) => paused.push(payload));
    const stopResumed = await tauri.onCollabSyncResumed((payload) => resumed.push(payload));
    const events = mocks.listen.mock.calls.map(([name]) => name);
    const deliver = (index: number, payload: unknown) =>
      (mocks.listen.mock.calls[index][1] as (event: { payload: unknown }) => void)({ payload });

    deliver(0, { projectId: "paper", changed: 12, total: 40, reason: "mass_change" });
    deliver(1, { projectId: "paper" });

    expect(events).toEqual(["collab-sync-paused", "collab-sync-resumed"]);
    expect(paused).toEqual([{ projectId: "paper", changed: 12, total: 40, reason: "mass_change" }]);
    expect(resumed).toEqual([{ projectId: "paper" }]);
    expect(stopPaused).toBe(mocks.unlisten);
    expect(stopResumed).toBe(mocks.unlisten);
  });
});
