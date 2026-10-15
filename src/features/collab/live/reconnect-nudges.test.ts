// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ collabLiveReconnectNow: vi.fn(), logError: vi.fn() }));

vi.mock("@/lib/tauri", () => ({ collabLiveReconnectNow: mocks.collabLiveReconnectNow }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { HIDDEN_LONG_MS, NUDGE_GAP_MS, startReconnectNudges } from "./reconnect-nudges";

let visibility: DocumentVisibilityState = "visible";

function show(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

let stop: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(1_760_000_000_000);
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  mocks.collabLiveReconnectNow.mockReset().mockResolvedValue(undefined);
  mocks.logError.mockReset();
  stop = startReconnectNudges();
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("reconnect nudges", () => {
  it("asks the live session to reconnect when the network comes back, at most once every few seconds", () => {
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));
    expect(mocks.collabLiveReconnectNow).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(NUDGE_GAP_MS);
    window.dispatchEvent(new Event("online"));
    expect(mocks.collabLiveReconnectNow).toHaveBeenCalledTimes(2);
  });

  it("asks when the window shows again after a long time hidden, and not after a short one", () => {
    show("hidden");
    vi.advanceTimersByTime(HIDDEN_LONG_MS - 1);
    show("visible");
    expect(mocks.collabLiveReconnectNow).not.toHaveBeenCalled();
    show("hidden");
    vi.advanceTimersByTime(HIDDEN_LONG_MS);
    show("visible");
    expect(mocks.collabLiveReconnectNow).toHaveBeenCalledTimes(1);
  });

  it("logs a failed request and keeps listening, and stops listening when live editing stops", async () => {
    mocks.collabLiveReconnectNow.mockRejectedValueOnce(new Error("no session"));
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(mocks.logError).toHaveBeenCalledWith("collab reconnect now", expect.any(Error)));
    stop?.();
    stop = null;
    vi.advanceTimersByTime(NUDGE_GAP_MS);
    window.dispatchEvent(new Event("online"));
    expect(mocks.collabLiveReconnectNow).toHaveBeenCalledTimes(1);
  });
});
