// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFilesStore } from "@/store/files";
import { DEFAULT_PANE_LAYOUT, layoutKey, movePane, reportSplitSizes, usePaneLayoutStore } from "@/store/pane-layout";
import { useSettingsStore } from "@/store/settings";
import {
  SAVED_LAYOUTS_KEY,
  SAVED_LAYOUT_LIMIT,
  useSavedLayoutsStore,
} from "./saved-layouts";

const FLAGS = { viewMode: "split", showTree: true, workspaceHidden: false, terminalOpen: false } as const;

function names(): string[] {
  return useSavedLayoutsStore.getState().layouts.map((layout) => layout.name);
}

function stored(): unknown {
  return JSON.parse(localStorage.getItem(SAVED_LAYOUTS_KEY) ?? "null");
}

beforeEach(() => {
  localStorage.clear();
  usePaneLayoutStore.setState({ layout: DEFAULT_PANE_LAYOUT });
  useSavedLayoutsStore.setState({ layouts: [], naming: null });
  useSettingsStore.setState({ ...FLAGS });
  useFilesStore.setState({ projectId: "p1" });
});

afterEach(() => {
  reportSplitSizes("horizontal", null);
  vi.resetModules();
});

describe("saved layouts", () => {

  it("renames, replaces under the same name, updates and deletes", () => {
    const store = useSavedLayoutsStore.getState();
    store.save("Writing");
    store.save("Review");
    const [writing, review] = useSavedLayoutsStore.getState().layouts;
    store.rename(writing?.id ?? "", "Drafting");
    expect(names()).toEqual(["Drafting", "Review"]);

    usePaneLayoutStore.getState().move("terminal", { kind: "edge", side: "top" });
    store.save("review");
    const replaced = useSavedLayoutsStore.getState().layouts[1];
    expect(replaced?.id).toBe(review?.id);
    expect(replaced?.name).toBe("review");
    expect(layoutKey(replaced?.tree ?? DEFAULT_PANE_LAYOUT)).toBe(layoutKey(usePaneLayoutStore.getState().layout));

    store.rename(writing?.id ?? "", "Review");
    expect(names()).toEqual(["Review"]);

    usePaneLayoutStore.getState().reset();
    store.update(writing?.id ?? "");
    expect(layoutKey(useSavedLayoutsStore.getState().layouts[0]?.tree ?? DEFAULT_PANE_LAYOUT)).toBe(layoutKey(DEFAULT_PANE_LAYOUT));
    store.remove(writing?.id ?? "");
    expect(names()).toEqual([]);
    expect(stored()).toEqual({ version: 1, layouts: [] });
  });

  it(`keeps at most ${SAVED_LAYOUT_LIMIT} layouts but still replaces one by name`, () => {
    const store = useSavedLayoutsStore.getState();
    for (let index = 0; index < SAVED_LAYOUT_LIMIT; index += 1) expect(store.save(`Layout ${index}`)).toBe(true);
    expect(store.save("One more")).toBe(false);
    expect(store.save("Layout 3")).toBe(true);
    expect(names()).toHaveLength(SAVED_LAYOUT_LIMIT);
    expect(store.save("   ")).toBe(false);
  });

  it("drops bad entries from a stored list and never throws on a broken one", async () => {
    const good = {
      id: "a",
      name: "Good",
      tree: movePane(DEFAULT_PANE_LAYOUT, "terminal", { kind: "edge", side: "top" }),
      flags: FLAGS,
    };
    localStorage.setItem(
      SAVED_LAYOUTS_KEY,
      JSON.stringify({
        version: 1,
        layouts: [
          good,
          { ...good, name: "Same id" },
          { id: "b", name: "", tree: good.tree, flags: FLAGS },
          { id: "c", name: "No tree", tree: "junk", flags: FLAGS },
          { id: "d", name: "Bad flags", tree: good.tree, flags: { ...FLAGS, viewMode: "wide" } },
          null,
        ],
      }),
    );
    vi.resetModules();
    let fresh = await import("./saved-layouts");
    expect(fresh.useSavedLayoutsStore.getState().layouts.map((layout) => layout.name)).toEqual(["Good"]);
    for (const raw of ["{", "[]", JSON.stringify({ version: 2, layouts: [good] })]) {
      localStorage.setItem(SAVED_LAYOUTS_KEY, raw);
      vi.resetModules();
      fresh = await import("./saved-layouts");
      expect(fresh.useSavedLayoutsStore.getState().layouts).toEqual([]);
    }
  });
});
