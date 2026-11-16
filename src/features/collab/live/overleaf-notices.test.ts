import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ overleafLiveResolve: vi.fn(), logError: vi.fn() }));

vi.mock("@/lib/overleaf-live", () => ({ overleafLiveResolve: mocks.overleafLiveResolve }));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import { applyOverleafNotice, useOverleafNotices } from "./overleaf-notices";

beforeEach(() => {
  mocks.overleafLiveResolve.mockReset().mockResolvedValue(undefined);
  useOverleafNotices.setState({
    projectId: "p1",
    maintenance: null,
    merged: [],
    reviews: [],
    unsteady: [],
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
});
