import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startCollabLive: vi.fn(() => () => {}),
  startLiveEditing: vi.fn(),
  startSyncPause: vi.fn(() => () => {}),
  stopSyncPause: vi.fn(),
  startRemovedNotices: vi.fn(() => () => {}),
  stopRemovedNotices: vi.fn(),
  startFileNotices: vi.fn(() => () => {}),
  stopFileNotices: vi.fn(),
}));

vi.mock("./live-store", () => ({ startCollabLive: mocks.startCollabLive }));
vi.mock("./live-editing", () => ({ startLiveEditing: mocks.startLiveEditing }));
vi.mock("./sync-pause", () => ({ startSyncPause: mocks.startSyncPause }));
vi.mock("./removed-notices", () => ({ startRemovedNotices: mocks.startRemovedNotices }));
vi.mock("./file-notices", () => ({ startFileNotices: mocks.startFileNotices }));

import { startLive } from "./index";

describe("live collaboration entry", () => {
  it("runs the live lifecycle with shared editing attached", () => {
    const stop = startLive();
    expect(mocks.startCollabLive).toHaveBeenCalledWith({ started: mocks.startLiveEditing });
    expect(typeof stop).toBe("function");
  });

  it("listens for paused outside changes for as long as live collaboration runs", () => {
    mocks.startSyncPause.mockClear();
    mocks.startSyncPause.mockReturnValue(mocks.stopSyncPause);
    const stop = startLive();
    const listening = mocks.startSyncPause.mock.calls.length;
    const stoppedEarly = mocks.stopSyncPause.mock.calls.length;
    stop();
    expect(listening).toBe(1);
    expect(stoppedEarly).toBe(0);
    expect(mocks.stopSyncPause).toHaveBeenCalledOnce();
  });

  it("tells people about files others deleted for as long as live collaboration runs", () => {
    mocks.startRemovedNotices.mockClear();
    mocks.startRemovedNotices.mockReturnValue(mocks.stopRemovedNotices);
    const stop = startLive();
    expect(mocks.startRemovedNotices).toHaveBeenCalledOnce();
    expect(mocks.stopRemovedNotices).not.toHaveBeenCalled();
    stop();
    expect(mocks.stopRemovedNotices).toHaveBeenCalledOnce();
  });

  it("tells people about figures waiting to be shared and copies kept for them while live collaboration runs", () => {
    mocks.startFileNotices.mockClear();
    mocks.startFileNotices.mockReturnValue(mocks.stopFileNotices);
    const stop = startLive();
    expect(mocks.startFileNotices).toHaveBeenCalledOnce();
    expect(mocks.stopFileNotices).not.toHaveBeenCalled();
    stop();
    expect(mocks.stopFileNotices).toHaveBeenCalledOnce();
  });
});
