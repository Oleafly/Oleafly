import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeDiff, diffKey, useDiffStore } from "./diff";

beforeEach(() => {
  localStorage.clear();
  useDiffStore.setState({ diffs: [], activeKey: null, mode: "split" });
});

describe("diff tabs", () => {
  it("keys a diff by side and path so one file can show both sides", () => {
    expect(diffKey({ path: "main.tex", side: "working" })).toBe("working:main.tex");
    expect(diffKey({ path: "main.tex", side: "staged" })).toBe("staged:main.tex");
  });

  it("opens a diff once and focuses it again when reopened", () => {
    const store = useDiffStore.getState();
    store.openDiff("main.tex", "working");
    store.openDiff("refs.bib", "staged");
    const order = useDiffStore.getState().diffs.map((diff) => diff.order);

    store.openDiff("main.tex", "working");

    const state = useDiffStore.getState();
    expect(state.diffs.map(diffKey)).toEqual(["working:main.tex", "staged:refs.bib"]);
    expect(state.diffs.map((diff) => diff.order)).toEqual(order);
    expect(activeDiff(state)).toMatchObject({ path: "main.tex", side: "working" });
  });

  it("closes the focused diff and leaves no diff focused", () => {
    useDiffStore.getState().openDiff("a.tex", "working");
    useDiffStore.getState().openDiff("b.tex", "working");

    useDiffStore.getState().closeDiff("working:a.tex");
    expect(useDiffStore.getState().activeKey).toBe("working:b.tex");

    useDiffStore.getState().closeDiff("working:b.tex");
    expect(useDiffStore.getState()).toMatchObject({ diffs: [], activeKey: null });
    expect(activeDiff(useDiffStore.getState())).toBeNull();
  });

  it("closes several diffs at once and keeps focus on one that stays", () => {
    const store = useDiffStore.getState();
    store.openDiff("a.tex", "working");
    store.openDiff("b.tex", "working");
    store.openDiff("c.tex", "disk");
    store.setActiveDiff("working:a.tex");

    store.closeDiffs(["working:b.tex", "disk:c.tex"]);
    expect(useDiffStore.getState()).toMatchObject({ activeKey: "working:a.tex" });
    expect(useDiffStore.getState().diffs.map(diffKey)).toEqual(["working:a.tex"]);

    store.closeDiffs(["working:a.tex"]);
    expect(useDiffStore.getState().activeKey).toBeNull();
  });

  it("ignores an empty close request", () => {
    useDiffStore.getState().openDiff("a.tex", "working");
    const before = useDiffStore.getState();

    useDiffStore.getState().closeDiffs([]);

    expect(useDiffStore.getState()).toBe(before);
  });

  it("drops focus to the file tabs", () => {
    useDiffStore.getState().openDiff("a.tex", "working");

    useDiffStore.getState().clearActiveDiff();

    expect(useDiffStore.getState().activeKey).toBeNull();
    expect(useDiffStore.getState().diffs).toHaveLength(1);
  });

  it("remembers the chosen layout across launches", async () => {
    useDiffStore.getState().setMode("unified");
    expect(localStorage.getItem("oleafly.diffMode")).toBe("unified");

    vi.resetModules();
    const reloaded = (await import("./diff")).useDiffStore;
    expect(reloaded.getState().mode).toBe("unified");
  });
});
