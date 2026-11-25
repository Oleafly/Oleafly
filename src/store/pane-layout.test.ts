// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PANE_LAYOUT,
  PANE_LAYOUT_KEY,
  isDefaultPaneLayout,
  layoutKey,
  moveChanges,
  movePane,
  movePaneToEdge,
  panelIdOf,
  parsePaneLayout,
  removePane,
  reportSplitSizes,
  resetPaneLayout,
  swapEditorAndPreview,
  swapPanes,
  usePaneLayoutStore,
  withLiveSizes,
  type PaneNode,
  type PaneSplit,
} from "./pane-layout";

const DEFAULT_KEY = "column(row(sidebar,row(editor,pdf)),terminal)";

function key(node: PaneNode): string {
  return layoutKey(node);
}

function sizesAddUp(node: PaneNode): void {
  if ("pane" in node) return;
  expect(node.sizes).toHaveLength(node.children.length);
  expect(node.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(100, 1);
  for (const child of node.children) sizesAddUp(child);
}

function band(layout: PaneSplit): PaneSplit {
  return layout.children[0] as PaneSplit;
}

beforeEach(() => {
  localStorage.clear();
  usePaneLayoutStore.setState({ layout: DEFAULT_PANE_LAYOUT });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("default layout", () => {
  it("is today's arrangement", () => {
    expect(key(DEFAULT_PANE_LAYOUT)).toBe(DEFAULT_KEY);
    expect(isDefaultPaneLayout(DEFAULT_PANE_LAYOUT)).toBe(true);
    sizesAddUp(DEFAULT_PANE_LAYOUT);
  });

  it("keeps the default ids when a move ends in the default arrangement", () => {
    const moved = movePane(DEFAULT_PANE_LAYOUT, "terminal", { kind: "pane", pane: "pdf", side: "bottom" });
    usePaneLayoutStore.getState().setLayout(moved);
    usePaneLayoutStore.getState().move("terminal", { kind: "edge", side: "bottom" });
    expect(usePaneLayoutStore.getState().layout).toBe(DEFAULT_PANE_LAYOUT);
  });
});

describe("moving a pane", () => {

  it("reorders inside the same split without breaking it up", () => {
    const swapped = movePane(DEFAULT_PANE_LAYOUT, "editor", { kind: "pane", pane: "pdf", side: "right" });
    expect(key(swapped)).toBe("column(row(sidebar,row(pdf,editor)),terminal)");
    const back = movePane(swapped, "editor", { kind: "pane", pane: "pdf", side: "left" });
    expect(key(back)).toBe(DEFAULT_KEY);
    expect(movePane(DEFAULT_PANE_LAYOUT, "editor", { kind: "pane", pane: "pdf", side: "left" })).toBe(
      DEFAULT_PANE_LAYOUT,
    );
  });

  it("stacks two siblings in place and keeps them as the document group", () => {
    const stacked = movePane(DEFAULT_PANE_LAYOUT, "editor", { kind: "pane", pane: "pdf", side: "top" });
    expect(key(stacked)).toBe("column(row(sidebar,column(editor,pdf)),terminal)");
    const document = band(stacked).children[1] as PaneSplit;
    expect([document.id, panelIdOf(document)]).toEqual(["document", "editorpdf"]);
  });

  it("tells whether a move would change the arrangement", () => {
    expect(moveChanges(DEFAULT_PANE_LAYOUT, "terminal", { kind: "edge", side: "bottom" })).toBe(false);
    expect(moveChanges(DEFAULT_PANE_LAYOUT, "editor", { kind: "pane", pane: "pdf", side: "left" })).toBe(false);
    expect(moveChanges(DEFAULT_PANE_LAYOUT, "editor", { kind: "edge", side: "top" })).toBe(true);
  });

  it("ignores drops on the pane itself or on unknown panes", () => {
    expect(movePane(DEFAULT_PANE_LAYOUT, "editor", { kind: "pane", pane: "editor", side: "left" })).toBe(
      DEFAULT_PANE_LAYOUT,
    );
    const noEditor = removePane(DEFAULT_PANE_LAYOUT, "editor") as PaneSplit;
    expect(movePane(noEditor, "editor", { kind: "edge", side: "left" })).toBe(noEditor);
    expect(movePane(noEditor, "pdf", { kind: "pane", pane: "editor", side: "left" })).toBe(noEditor);
  });

  it("collapses a split left with one pane and renormalizes what stays", () => {
    const rest = removePane(DEFAULT_PANE_LAYOUT, "pdf") as PaneSplit;
    expect(key(rest)).toBe("column(row(sidebar,editor),terminal)");
    sizesAddUp(rest);
    const alone = removePane({ id: "s1", direction: "row", children: [{ pane: "editor" }], sizes: [100] }, "editor");
    expect(alone).toBeNull();
  });

  it("swaps two panes in place", () => {
    expect(key(swapPanes(DEFAULT_PANE_LAYOUT, "editor", "pdf"))).toBe(
      "column(row(sidebar,row(pdf,editor)),terminal)",
    );
    expect(key(swapPanes(DEFAULT_PANE_LAYOUT, "sidebar", "terminal"))).toBe(
      "column(row(terminal,row(editor,pdf)),sidebar)",
    );
  });
});

describe("reading a saved layout", () => {
  it("falls back to the default for missing or broken values", () => {
    for (const raw of [null, "", "nope", "null", "[]", "42", '{"direction":"diagonal","children":[]}']) {
      expect(parsePaneLayout(raw)).toBe(DEFAULT_PANE_LAYOUT);
    }
  });

  it("keeps a valid tree with its ids and version", () => {
    const moved = movePane(DEFAULT_PANE_LAYOUT, "terminal", { kind: "pane", pane: "pdf", side: "bottom" });
    expect(parsePaneLayout(JSON.stringify({ version: 2, root: moved }))).toEqual(moved);
  });

  it("falls back to the default for a version it does not know", () => {
    const moved = movePane(DEFAULT_PANE_LAYOUT, "terminal", { kind: "edge", side: "top" });
    expect(parsePaneLayout(JSON.stringify({ version: 3, root: moved }))).toBe(DEFAULT_PANE_LAYOUT);
    expect(parsePaneLayout(JSON.stringify({ version: 2 }))).toBe(DEFAULT_PANE_LAYOUT);
  });

  it("places missing panes beside whatever is left", () => {
    expect(key(parsePaneLayout(JSON.stringify({ pane: "sidebar" })))).toBe(
      "column(row(sidebar,editor,pdf),terminal)",
    );
    expect(key(parsePaneLayout(JSON.stringify({ pane: "terminal" })))).toBe("row(terminal,sidebar,editor,pdf)");
  });
});

describe("pane layout store", () => {

  it("swaps the editor and the preview and skips changes that keep the layout", () => {
    swapEditorAndPreview();
    expect(key(usePaneLayoutStore.getState().layout)).toBe("column(row(sidebar,row(pdf,editor)),terminal)");
    const before = usePaneLayoutStore.getState().layout;
    usePaneLayoutStore.getState().setLayout(before);
    expect(usePaneLayoutStore.getState().layout).toBe(before);
    swapEditorAndPreview();
    expect(usePaneLayoutStore.getState().layout).toBe(DEFAULT_PANE_LAYOUT);
  });

  it("keeps working in memory when storage refuses writes", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    movePaneToEdge("terminal", "top");
    expect(key(usePaneLayoutStore.getState().layout)).toBe("column(terminal,row(sidebar,row(editor,pdf)))");
    resetPaneLayout();
    expect(usePaneLayoutStore.getState().layout).toBe(DEFAULT_PANE_LAYOUT);
  });

  it("starts the moved panes from the sizes on screen and leaves the store alone for a move that changes nothing", () => {
    reportSplitSizes("horizontal", { sidebar: 30, editorpdf: 70, });
    reportSplitSizes("document", { editor: 70, pdf: 30 });
    const before = usePaneLayoutStore.getState().layout;
    usePaneLayoutStore.getState().move("terminal", { kind: "edge", side: "bottom" });
    expect(usePaneLayoutStore.getState().layout).toBe(before);
    usePaneLayoutStore.getState().move("terminal", { kind: "pane", pane: "pdf", side: "bottom" });
    const moved = usePaneLayoutStore.getState().layout;
    expect(moved.sizes).toEqual([30, 70]);
    expect((moved.children[1] as PaneSplit).sizes).toEqual([70, 30]);
    reportSplitSizes("horizontal", null);
    reportSplitSizes("document", null);
  });

  it("scales sizes on screen into the share the visible panes hold", () => {
    reportSplitSizes("horizontal", { sidebar: 40, editorpdf: 60 });
    const sized = withLiveSizes(DEFAULT_PANE_LAYOUT);
    expect(band(sized).sizes).toEqual([40, 60]);
    reportSplitSizes("horizontal", { stale: 100 });
    expect(band(withLiveSizes(DEFAULT_PANE_LAYOUT)).sizes).toEqual([25, 75]);
    reportSplitSizes("horizontal", null);
  });

  it("starts from the saved layout", async () => {
    const moved = movePane(DEFAULT_PANE_LAYOUT, "terminal", { kind: "edge", side: "right" });
    localStorage.setItem(PANE_LAYOUT_KEY, JSON.stringify({ version: 2, root: moved }));
    vi.resetModules();
    const fresh = await import("./pane-layout");
    expect(fresh.layoutKey(fresh.usePaneLayoutStore.getState().layout)).toBe(key(moved));
  });

  it("starts from the default when there is nothing to read", async () => {
    vi.resetModules();
    let fresh = await import("./pane-layout");
    expect(fresh.usePaneLayoutStore.getState().layout).toBe(fresh.DEFAULT_PANE_LAYOUT);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.resetModules();
    fresh = await import("./pane-layout");
    expect(fresh.usePaneLayoutStore.getState().layout).toBe(fresh.DEFAULT_PANE_LAYOUT);
  });
});
