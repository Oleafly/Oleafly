import { beforeEach, describe, expect, it } from "vitest";
import { useDiffStore } from "@/store/diff";
import { useFilesStore } from "@/store/files";
import { useNoteTabsStore } from "@/store/note-tabs";
import {
  closeAllEditorTabs,
  closeEditorTab,
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

describe("personal note tabs in the strip", () => {
  beforeEach(() => {
    useNoteTabsStore.setState({
      tabs: [
        { id: "note-a", projectId: "project", order: 6 },
        { id: "note-b", projectId: "elsewhere", order: 7 },
      ],
      active: null,
      markdown: {},
    });
  });

  it("orders note tabs with the others and keeps other projects' notes out", () => {
    expect(stripKeys()).toEqual(["f:a.tex", "d:working:a.tex", "f:b.tex", "d:staged:refs.bib", "f:c.tex", "n:note-a"]);
    expect(editorTabs([], {}, [], [{ id: "x", projectId: "p", order: 1 }])).toEqual([{ kind: "note", id: "x", order: 1 }]);
  });

  it("closes a focused note tab and gives focus back to the anchor file", () => {
    useNoteTabsStore.getState().setActive("note-a");
    closeEditorTabsAround("f:b.tex", "right");
    expect(useNoteTabsStore.getState().tabs.map((tab) => tab.id)).toEqual(["note-b"]);
    expect(useNoteTabsStore.getState().active).toBeNull();
    expect(useFilesStore.getState().activePath).toBe("b.tex");
  });

  it("focuses a note tab that stays open when the visible note closes", () => {
    useNoteTabsStore.setState({
      tabs: [
        { id: "note-a", projectId: "project", order: 6 },
        { id: "note-c", projectId: "project", order: 8 },
      ],
      active: "note-c",
    });
    closeEditorTabsAround("n:note-a", "right");
    expect(useNoteTabsStore.getState().active).toBe("note-a");
  });

  it("closes a single note tab", () => {
    closeEditorTab({ kind: "note", id: "note-a", order: 6 });
    expect(useNoteTabsStore.getState().tabs.map((tab) => tab.id)).toEqual(["note-b"]);
  });

  it("closes every tab, notes included", () => {
    closeAllEditorTabs();
    expect(useNoteTabsStore.getState().tabs.map((tab) => tab.id)).toEqual(["note-b"]);
    expect(useFilesStore.getState().openTabs).toEqual([]);
  });
});
