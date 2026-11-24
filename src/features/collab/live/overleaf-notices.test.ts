import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    overleafLiveResolve: vi.fn(),
    overleafLiveRetry: vi.fn(),
    overleafLiveKeepCopy: vi.fn(),
    saveFile: vi.fn(),
    collabRelive: vi.fn(),
    logError: vi.fn(),
  };
});

vi.mock("@/lib/overleaf-live", () => ({
  overleafLiveResolve: mocks.overleafLiveResolve,
  overleafLiveRetry: mocks.overleafLiveRetry,
  overleafLiveKeepCopy: mocks.overleafLiveKeepCopy,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));
vi.mock("@/lib/collab-live-bridge", async () => {
  const { create } = await import("zustand");
  return {
    collabRelive: mocks.collabRelive,
    useOverleafFilling: create<{ projectId: string | null }>(() => ({ projectId: null })),
  };
});
vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => ({ saveFile: mocks.saveFile }) } }));

import { applyOverleafNotice, useOverleafNotices } from "./overleaf-notices";

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.overleafLiveResolve.mockReset().mockResolvedValue(undefined);
  for (const [name, mock] of [
    ["save", mocks.saveFile],
    ["retry", mocks.overleafLiveRetry],
    ["keep", mocks.overleafLiveKeepCopy],
    ["relive", mocks.collabRelive],
  ] as const) {
    mock.mockReset().mockImplementation(async () => {
      mocks.calls.push(name);
    });
  }
  useOverleafNotices.setState({
    projectId: "p1",
    maintenance: null,
    merged: [],
    reviews: [],
    unsteady: [],
    stopped: [],
    external: [],
    replaced: null,
    settings: [],
    filling: null,
    slowAck: false,
    resolving: null,
    failed: null,
  });
});

describe("Overleaf notices", () => {
  it("keeps one review and one merge per path, and ignores other projects", () => {
    applyOverleafNotice({ projectId: "p1", kind: "needs_review", path: "main.tex", mine: "a", theirs: "b" });
    applyOverleafNotice({ projectId: "p1", kind: "needs_review", path: "main.tex", mine: "a2", theirs: "b2" });
    applyOverleafNotice({ projectId: "p2", kind: "needs_review", path: "other.tex", mine: "x", theirs: "y" });
    applyOverleafNotice({ projectId: "p1", kind: "merged", path: "main.tex", before: "a", after: "ab" });
    const state = useOverleafNotices.getState();
    expect(state.reviews).toEqual([{ projectId: "p1", kind: "needs_review", path: "main.tex", mine: "a2", theirs: "b2" }]);
    expect(state.merged.map((entry) => entry.after)).toEqual(["ab"]);
  });

  it("counts maintenance from when the notice arrives", () => {
    applyOverleafNotice({ projectId: "p1", kind: "maintenance", message: "Back soon", delayMs: 30_000 }, 1_000);
    expect(useOverleafNotices.getState().maintenance).toEqual({ message: "Back soon", until: 31_000 });
  });

  it("lists a doc that keeps failing once and tracks unconfirmed changes", () => {
    applyOverleafNotice({ projectId: "p1", kind: "unsteady", path: "main.tex" });
    applyOverleafNotice({ projectId: "p1", kind: "unsteady", path: "main.tex" });
    applyOverleafNotice({ projectId: "p1", kind: "slow_ack", waiting: true });
    expect(useOverleafNotices.getState().unsteady).toEqual(["main.tex"]);
    expect(useOverleafNotices.getState().slowAck).toBe(true);
  });

  it("settles a review through the app and drops it", async () => {
    applyOverleafNotice({ projectId: "p1", kind: "needs_review", path: "main.tex", mine: "a", theirs: "b" });
    await useOverleafNotices.getState().resolve("main.tex", "theirs");
    expect(mocks.overleafLiveResolve).toHaveBeenCalledWith("p1", "main.tex", "theirs");
    expect(useOverleafNotices.getState().reviews).toEqual([]);
  });

  it("keeps a review whose choice failed and says so", async () => {
    mocks.overleafLiveResolve.mockRejectedValueOnce(new Error("not live"));
    applyOverleafNotice({ projectId: "p1", kind: "needs_review", path: "main.tex", mine: "a", theirs: "b" });
    await useOverleafNotices.getState().resolve("main.tex", "mine");
    expect(useOverleafNotices.getState().reviews).toHaveLength(1);
    expect(useOverleafNotices.getState().failed).toBe("main.tex");
  });

  it("keeps one stopped line per file with its latest reason, and notes outside changes and replaced characters", () => {
    applyOverleafNotice({ projectId: "p1", kind: "fault", path: "main.tex", reason: "refused" });
    applyOverleafNotice({ projectId: "p1", kind: "fault", path: "main.tex", reason: "too_long" });
    applyOverleafNotice({ projectId: "p2", kind: "fault", path: "other.tex", reason: "bad_hash" });
    applyOverleafNotice({ projectId: "p1", kind: "external", path: "main.tex" });
    applyOverleafNotice({ projectId: "p1", kind: "external", path: "main.tex" });
    applyOverleafNotice({ projectId: "p1", kind: "replaced", path: "intro.tex" });
    const state = useOverleafNotices.getState();
    expect(state.stopped.map(({ path, reason }) => ({ path, reason }))).toEqual([{ path: "main.tex", reason: "too_long" }]);
    expect(state.external).toEqual(["main.tex"]);
    expect(state.replaced).toBe("intro.tex");
    state.dismissExternal("main.tex");
    state.dismissReplaced();
    expect(useOverleafNotices.getState().external).toEqual([]);
    expect(useOverleafNotices.getState().replaced).toBeNull();
  });

  it("keeps the latest reason for each setting that didn't reach Overleaf until dismissed", () => {
    applyOverleafNotice({ projectId: "p1", kind: "setting_not_sent", setting: "compiler", reason: "failed" });
    applyOverleafNotice({ projectId: "p1", kind: "setting_not_sent", setting: "main_doc", reason: "conflict" });
    applyOverleafNotice({ projectId: "p1", kind: "setting_not_sent", setting: "compiler", reason: "no_equivalent" });
    applyOverleafNotice({ projectId: "p2", kind: "setting_not_sent", setting: "spelling", reason: "refused" });
    expect(useOverleafNotices.getState().settings).toEqual([
      { setting: "main_doc", reason: "conflict" },
      { setting: "compiler", reason: "no_equivalent" },
    ]);
    useOverleafNotices.getState().dismissSettings();
    expect(useOverleafNotices.getState().settings).toEqual([]);
  });

  it("saves a stopped file before trying it live again, then puts its tab back on the live session", async () => {
    applyOverleafNotice({ projectId: "p1", kind: "fault", path: "main.tex", reason: "bad_hash" });
    await useOverleafNotices.getState().tryLiveAgain("main.tex");
    expect(mocks.calls).toEqual(["save", "retry", "relive"]);
    expect(mocks.saveFile).toHaveBeenCalledWith("main.tex");
    expect(mocks.overleafLiveRetry).toHaveBeenCalledWith("p1", "main.tex");
    expect(mocks.collabRelive).toHaveBeenCalledWith("main.tex");
    expect(useOverleafNotices.getState().stopped).toEqual([]);
  });

  it("saves a stopped file before keeping it as a copy and reloading it", async () => {
    applyOverleafNotice({ projectId: "p1", kind: "fault", path: "main.tex", reason: "too_large" });
    await useOverleafNotices.getState().keepCopy("main.tex");
    expect(mocks.calls).toEqual(["save", "keep", "relive"]);
    expect(mocks.overleafLiveKeepCopy).toHaveBeenCalledWith("p1", "main.tex");
    expect(useOverleafNotices.getState().stopped).toEqual([]);
  });

  it("keeps a stopped file whose retry failed, leaves its tab local and says so", async () => {
    mocks.overleafLiveRetry.mockRejectedValueOnce(new Error("not live"));
    applyOverleafNotice({ projectId: "p1", kind: "fault", path: "main.tex", reason: "refused" });
    await useOverleafNotices.getState().tryLiveAgain("main.tex");
    expect(mocks.collabRelive).not.toHaveBeenCalled();
    expect(useOverleafNotices.getState().stopped).toHaveLength(1);
    expect(useOverleafNotices.getState().failed).toBe("main.tex");
    expect(useOverleafNotices.getState().resolving).toBeNull();
  });

  it("follows an open from Overleaf until it has finished", () => {
    applyOverleafNotice({ projectId: "p1", kind: "filling", done: 1, total: 4 });
    applyOverleafNotice({ projectId: "p2", kind: "filling", done: 0, total: 9 });
    expect(useOverleafNotices.getState().filling).toEqual({ done: 1, total: 4 });
    applyOverleafNotice({ projectId: "p1", kind: "filling", done: 4, total: 4 });
    expect(useOverleafNotices.getState().filling).toEqual({ done: 4, total: 4 });
    applyOverleafNotice({ projectId: "p1", kind: "filled" });
    expect(useOverleafNotices.getState().filling).toBeNull();
  });
});
