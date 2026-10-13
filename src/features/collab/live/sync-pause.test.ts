import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollabSyncPaused, CollabSyncResumed } from "@/lib/tauri";

const mocks = vi.hoisted(() => ({
  collabSyncDecide: vi.fn(),
  logError: vi.fn(async () => {}),
  handlers: {} as Record<string, ((payload: unknown) => void) | undefined>,
  unlisten: vi.fn(),
}));

function listener(name: string) {
  return vi.fn(async (handler: (payload: unknown) => void) => {
    mocks.handlers[name] = handler;
    return () => {
      mocks.unlisten(name);
      if (mocks.handlers[name] === handler) mocks.handlers[name] = undefined;
    };
  });
}

vi.mock("@/lib/tauri", () => ({
  collabSyncDecide: mocks.collabSyncDecide,
  onCollabSyncPaused: listener("paused"),
  onCollabSyncResumed: listener("resumed"),
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { startSyncPause, useSyncPauseStore } from "./sync-pause";

const paused = (payload: Partial<CollabSyncPaused> = {}) =>
  mocks.handlers.paused?.({
    projectId: "paper",
    changed: 12,
    total: 40,
    reason: "mass_change",
    ...payload,
  } satisfies CollabSyncPaused);
const resumed = (payload: CollabSyncResumed = { projectId: "paper" }) => mocks.handlers.resumed?.(payload);

let stop: () => void = () => {};

async function started() {
  stop = startSyncPause();
  await vi.waitFor(() => expect(mocks.handlers.resumed).toBeDefined());
}

beforeEach(() => {
  mocks.collabSyncDecide.mockReset();
  mocks.collabSyncDecide.mockResolvedValue(undefined);
  mocks.logError.mockClear();
  mocks.unlisten.mockClear();
  mocks.handlers = {};
});

afterEach(() => {
  stop();
});

describe("sync pause", () => {
  it("remembers how many files wait for a decision, one question per project", async () => {
    await started();
    paused({ changed: 12 });
    paused({ changed: 15 });
    paused({ projectId: "thesis", changed: 4 });

    expect(useSyncPauseStore.getState().waiting).toEqual({ paper: 15, thesis: 4 });
  });

  it("sends the decision for the project and forgets the question", async () => {
    await started();
    paused();
    paused({ projectId: "thesis", changed: 4 });

    await useSyncPauseStore.getState().decide("paper", "send");
    await useSyncPauseStore.getState().decide("thesis", "keep_local");

    expect(mocks.collabSyncDecide.mock.calls).toEqual([
      ["paper", "send"],
      ["thesis", "keep_local"],
    ]);
    expect(useSyncPauseStore.getState().waiting).toEqual({});
    expect(useSyncPauseStore.getState().deciding).toBeNull();
  });

  it("takes one decision at a time", async () => {
    await started();
    paused();
    paused({ projectId: "thesis", changed: 4 });
    let finish: () => void = () => {};
    mocks.collabSyncDecide.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)));

    const first = useSyncPauseStore.getState().decide("paper", "send");
    await useSyncPauseStore.getState().decide("thesis", "keep_local");
    expect(useSyncPauseStore.getState().deciding).toEqual({ projectId: "paper", decision: "send" });
    finish();
    await first;

    expect(mocks.collabSyncDecide.mock.calls).toEqual([["paper", "send"]]);
    expect(useSyncPauseStore.getState().waiting).toEqual({ thesis: 4 });
    expect(useSyncPauseStore.getState().deciding).toBeNull();
  });

  it("keeps the question when the decision could not be applied", async () => {
    await started();
    paused();
    mocks.collabSyncDecide.mockRejectedValue(new Error("this project is not live"));

    await useSyncPauseStore.getState().decide("paper", "send");

    expect(useSyncPauseStore.getState().waiting).toEqual({ paper: 12 });
    expect(useSyncPauseStore.getState().deciding).toBeNull();
    expect(mocks.logError).toHaveBeenCalledWith("collab sync decision", expect.any(Error));
  });

  it("marks the folder unavailable until it comes back without touching the question", async () => {
    await started();
    paused();
    paused({ changed: 0, total: 40, reason: "root_unavailable" });
    const gone = useSyncPauseStore.getState();
    resumed();

    expect(gone.unavailable).toEqual({ paper: true });
    expect(gone.waiting).toEqual({ paper: 12 });
    expect(useSyncPauseStore.getState().unavailable).toEqual({});
    expect(useSyncPauseStore.getState().waiting).toEqual({ paper: 12 });
  });

  it("stops listening and clears every question when stopped", async () => {
    await started();
    paused();
    paused({ projectId: "thesis", reason: "root_unavailable" });

    stop();
    await vi.waitFor(() => expect(mocks.unlisten).toHaveBeenCalledTimes(2));

    expect(useSyncPauseStore.getState().waiting).toEqual({});
    expect(useSyncPauseStore.getState().unavailable).toEqual({});
  });
});
