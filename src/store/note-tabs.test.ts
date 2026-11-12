import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDiffStore } from "@/store/diff";
import { useFilesStore } from "@/store/files";
import {
  activeNoteTab,
  clearActiveNoteTab,
  editsAsMarkdown,
  markdownKey,
  noteTabsFor,
  useNoteTabsStore,
} from "./note-tabs";

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  useNoteTabsStore.setState({ tabs: [], active: null, markdown: {} });
  useDiffStore.setState({ diffs: [], activeKey: null });
  useFilesStore.setState({ projectId: "paper", activePath: "main.tex", openTabs: ["main.tex"] });
});

describe("note tabs", () => {
  it("opens a note once, activates it and takes focus from a diff", () => {
    useDiffStore.getState().openDiff("main.tex", "working");
    const store = useNoteTabsStore.getState();
    store.open("paper", "n1", { icon: "lucide:atom" });
    store.open("paper", "n1");
    expect(useNoteTabsStore.getState().tabs).toHaveLength(1);
    expect(useNoteTabsStore.getState().tabs[0]).toMatchObject({ id: "n1", projectId: "paper", icon: "lucide:atom" });
    expect(useNoteTabsStore.getState().active).toBe("n1");
    expect(useDiffStore.getState().activeKey).toBeNull();
  });

  it("updates the look when an open note is opened again with one", () => {
    useNoteTabsStore.getState().open("paper", "n1");
    useNoteTabsStore.getState().open("paper", "n1", { color: "mint" });
    expect(useNoteTabsStore.getState().tabs[0].color).toBe("mint");
  });

  it("drops tabs of another project when a note opens", () => {
    useNoteTabsStore.getState().open("thesis", "old");
    useNoteTabsStore.getState().open("paper", "n1");
    expect(useNoteTabsStore.getState().tabs.map((tab) => tab.id)).toEqual(["n1"]);
  });

  it("closes tabs and clears the active one", () => {
    const store = useNoteTabsStore.getState();
    store.open("paper", "n1");
    store.open("paper", "n2");
    store.close("n1");
    expect(useNoteTabsStore.getState().active).toBe("n2");
    store.closeMany([]);
    store.closeMany(["n2"]);
    expect(useNoteTabsStore.getState()).toMatchObject({ tabs: [], active: null });
  });

  it("moves focus between notes and clears it", () => {
    const store = useNoteTabsStore.getState();
    store.open("paper", "n1");
    store.open("paper", "n2");
    useDiffStore.setState({ activeKey: null });
    store.setActive("n1");
    expect(useNoteTabsStore.getState().active).toBe("n1");
    clearActiveNoteTab();
    expect(useNoteTabsStore.getState().active).toBeNull();
    const before = useNoteTabsStore.getState();
    clearActiveNoteTab();
    expect(useNoteTabsStore.getState()).toBe(before);
  });

  it("gives focus back to a file or a diff that the person picks", () => {
    useNoteTabsStore.getState().open("paper", "n1");
    useFilesStore.getState().setActive("main.tex");
    expect(useNoteTabsStore.getState().active).toBeNull();
    useNoteTabsStore.getState().setActive("n1");
    useDiffStore.getState().openDiff("main.tex", "staged");
    expect(useNoteTabsStore.getState().active).toBeNull();
  });

  it("keeps the store when the look does not change and ignores unknown tabs", () => {
    useNoteTabsStore.getState().open("paper", "n1", { icon: "a", color: "mint" });
    const before = useNoteTabsStore.getState().tabs;
    useNoteTabsStore.getState().setLook("n1", { icon: "a", color: "mint" });
    useNoteTabsStore.getState().setLook("missing", { icon: "b" });
    expect(useNoteTabsStore.getState().tabs).toBe(before);
    useNoteTabsStore.getState().setLook("n1", { icon: "b" });
    expect(useNoteTabsStore.getState().tabs[0]).toMatchObject({ icon: "b" });
  });

  it("remembers which note files are edited as Markdown", () => {
    const store = useNoteTabsStore.getState();
    store.setMarkdown("paper", "notes/a.md", true);
    const marked = useNoteTabsStore.getState().markdown;
    store.setMarkdown("paper", "notes/a.md", true);
    expect(useNoteTabsStore.getState().markdown).toBe(marked);
    expect(editsAsMarkdown(useNoteTabsStore.getState(), "paper", "notes/a.md")).toBe(true);
    expect(editsAsMarkdown(useNoteTabsStore.getState(), null, "notes/a.md")).toBe(false);
    expect(editsAsMarkdown(useNoteTabsStore.getState(), "paper", null)).toBe(false);
    store.setMarkdown("paper", "notes/a.md", false);
    expect(useNoteTabsStore.getState().markdown).toEqual({});
    expect(markdownKey("p", "x")).toBe("p\u0000x");
  });

  it("keeps the Edit as Markdown choice for a file across a restart", async () => {
    const saved = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => void saved.set(key, value),
    });
    useNoteTabsStore.getState().setMarkdown("paper", "notes/a.md", true);
    useNoteTabsStore.getState().setMarkdown("paper", "notes/b.md", true);
    useNoteTabsStore.getState().setMarkdown("paper", "notes/b.md", false);
    vi.resetModules();
    const restarted = await import("./note-tabs");
    const state = restarted.useNoteTabsStore.getState();
    expect(restarted.editsAsMarkdown(state, "paper", "notes/a.md")).toBe(true);
    expect(restarted.editsAsMarkdown(state, "paper", "notes/b.md")).toBe(false);
  });

  it("lists and reports only the open project's tabs", () => {
    useNoteTabsStore.setState({
      tabs: [
        { id: "n1", projectId: "paper", order: 1 },
        { id: "n2", projectId: "thesis", order: 2 },
      ],
      active: "n2",
    });
    const state = useNoteTabsStore.getState();
    expect(noteTabsFor(state, "paper").map((tab) => tab.id)).toEqual(["n1"]);
    expect(noteTabsFor(state, null)).toEqual([]);
    expect(noteTabsFor({ tabs: [state.tabs[0]] }, "paper")).toEqual([state.tabs[0]]);
    expect(activeNoteTab(state, "paper")).toBeNull();
    expect(activeNoteTab(state, "thesis")).toBe("n2");
    expect(activeNoteTab(state, null)).toBeNull();
    expect(activeNoteTab({ ...state, active: null }, "thesis")).toBeNull();
  });
});
