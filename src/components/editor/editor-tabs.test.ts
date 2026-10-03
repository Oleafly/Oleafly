import { beforeEach, describe, expect, it } from "vitest";
import { useDiffStore } from "@/store/diff";
import { useFilesStore } from "@/store/files";
import {
  closeAllEditorTabs,
  closeAssistantTabs,
  closeEditorTabsAround,
  currentEditorTabs,
  editorTabKey,
  editorTabs,
  openAssistantTabs,
  tabsToClose,
} from "./editor-tabs";

const CLEAN = { content: "x\n", dirty: false };

function seedStrip() {
  useFilesStore.setState({
    projectId: "project",
    files: { "a.tex": CLEAN, "b.tex": CLEAN, "c.tex": CLEAN },
    openTabs: ["a.tex", "b.tex", "c.tex"],
    tabOrder: { "a.tex": 1, "b.tex": 3, "c.tex": 5 },
    assistantTabs: ["b.tex", "c.tex"],
    activePath: "a.tex",
  });
  useDiffStore.setState({
    diffs: [
      { path: "a.tex", side: "working", order: 2 },
      { path: "refs.bib", side: "staged", order: 4 },
    ],
    activeKey: null,
  });
}

function stripKeys(): string[] {
  return currentEditorTabs().map(editorTabKey);
}

beforeEach(seedStrip);

describe("editor tab strip order", () => {
  it("interleaves files and diffs by open order, with unstamped files first", () => {
    expect(stripKeys()).toEqual([
      "f:a.tex",
      "d:working:a.tex",
      "f:b.tex",
      "d:staged:refs.bib",
      "f:c.tex",
    ]);
    expect(editorTabs(["late.tex", "early.tex"], { "late.tex": 9 }, []).map((tab) => tab.id)).toEqual([
      "early.tex",
      "late.tex",
    ]);
  });

  it("picks the tabs to close around an anchor in the order the strip shows", () => {
    const tabs = currentEditorTabs();
    const keys = (scope: Parameters<typeof tabsToClose>[2]) =>
      tabsToClose(tabs, "f:b.tex", scope).map(editorTabKey);

    expect(keys("others")).toEqual(["f:a.tex", "d:working:a.tex", "d:staged:refs.bib", "f:c.tex"]);
    expect(keys("left")).toEqual(["f:a.tex", "d:working:a.tex"]);
    expect(keys("right")).toEqual(["d:staged:refs.bib", "f:c.tex"]);
    expect(keys("all")).toHaveLength(5);
    expect(tabsToClose(tabs, "f:missing.tex", "all")).toEqual([]);
  });
});

describe("closing editor tabs together", () => {
  it("closes the others and brings the anchor forward when the visible tab closed", () => {
    closeEditorTabsAround("f:b.tex", "others");

    expect(stripKeys()).toEqual(["f:b.tex"]);
    expect(useFilesStore.getState().activePath).toBe("b.tex");
    expect(useFilesStore.getState().assistantTabs).toEqual(["b.tex"]);
  });

  it("closes to the left of a diff tab, including files and diffs", () => {
    useDiffStore.setState({ activeKey: "working:a.tex" });

    closeEditorTabsAround("d:staged:refs.bib", "left");

    expect(stripKeys()).toEqual(["d:staged:refs.bib", "f:c.tex"]);
    expect(useDiffStore.getState().activeKey).toBe("staged:refs.bib");
  });

  it("closes to the right and leaves the visible tab alone when it stays open", () => {
    closeEditorTabsAround("f:b.tex", "right");

    expect(stripKeys()).toEqual(["f:a.tex", "d:working:a.tex", "f:b.tex"]);
    expect(useFilesStore.getState().activePath).toBe("a.tex");
    expect(useFilesStore.getState().assistantTabs).toEqual(["b.tex"]);
  });

  it("closes every tab from the menu and from the palette", () => {
    closeEditorTabsAround("f:b.tex", "all");
    expect(stripKeys()).toEqual([]);
    expect(useFilesStore.getState().activePath).toBeNull();

    seedStrip();
    closeAllEditorTabs();
    expect(stripKeys()).toEqual([]);
    expect(useDiffStore.getState().diffs).toEqual([]);
  });

  it("closes only the files the assistant opened", () => {
    useFilesStore.setState({ activePath: "c.tex" });
    expect(openAssistantTabs()).toEqual(["b.tex", "c.tex"]);

    closeAssistantTabs();

    expect(stripKeys()).toEqual(["f:a.tex", "d:working:a.tex", "d:staged:refs.bib"]);
    expect(useFilesStore.getState()).toMatchObject({ activePath: "a.tex", assistantTabs: [] });
    expect(openAssistantTabs()).toEqual([]);
  });

  it("closes several diffs and drops focus from a closed one", () => {
    useDiffStore.setState({ activeKey: "staged:refs.bib" });

    useDiffStore.getState().closeDiffs(["staged:refs.bib", "working:a.tex"]);

    expect(useDiffStore.getState()).toMatchObject({ diffs: [], activeKey: null });
  });
});
