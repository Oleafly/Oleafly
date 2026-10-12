import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startCollabLive: vi.fn(() => () => {}),
  startLiveEditing: vi.fn(),
}));

vi.mock("./live-store", () => ({ startCollabLive: mocks.startCollabLive }));
vi.mock("./live-editing", () => ({ startLiveEditing: mocks.startLiveEditing }));

import { startLive } from "./index";

describe("live collaboration entry", () => {
  it("runs the live lifecycle with shared editing attached", () => {
    const stop = startLive();
    expect(mocks.startCollabLive).toHaveBeenCalledWith({ started: mocks.startLiveEditing });
    expect(typeof stop).toBe("function");
  });
});
