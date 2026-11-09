// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PANE_LAYOUT,
  PANE_LAYOUT_KEY,
  groupDomIdOf,
  groupNameOf,
  insertAtEdge,
  isDefaultPaneLayout,
  layoutKey,
  legacyGroupOf,
  movePane,
  movePaneToEdge,
  nodeShown,
  normalizeSizes,
  panelIdOf,
  paneLayoutIsDefault,
  paneSide,
  parentSplitOf,
  parsePaneLayout,
  removePane,
  renderedChildren,
  resetPaneLayout,
  separatorIdOf,
  storageOrderOf,
  swapEditorAndPreview,
  swapPanes,
  usePaneLayoutStore,
  type PaneNode,
  type PaneShown,
  type PaneSplit,
} from "./pane-layout";

const DEFAULT_KEY = "column(row(sidebar,row(editor,pdf),assistant),terminal)";
const ALL_SHOWN: PaneShown = { sidebar: true, editor: true, pdf: true, terminal: true, assistant: true };

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

  it("names its groups, panels and separators like the fixed layout did", () => {
    const horizontal = band(DEFAULT_PANE_LAYOUT);
    const document = horizontal.children[1] as PaneSplit;
    expect([groupNameOf(DEFAULT_PANE_LAYOUT), groupNameOf(horizontal), groupNameOf(document)]).toEqual([
      "vertical",
      "horizontal",
      "document",
    ]);
    expect([panelIdOf(horizontal), panelIdOf(document)]).toEqual(["content-band", "editorpdf"]);
    expect([groupDomIdOf(DEFAULT_PANE_LAYOUT), groupDomIdOf(horizontal), groupDomIdOf(document)]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(storageOrderOf(horizontal)).toEqual(["sidebar", "editorpdf", "assistant"]);
    const all = ["sidebar", "editorpdf", "assistant"];
    expect(separatorIdOf(DEFAULT_PANE_LAYOUT, ["content-band", "terminal"], "content-band", "terminal")).toBe(
      "v-terminal",
    );
    expect(separatorIdOf(horizontal, all, "sidebar", "editorpdf")).toBe("h-tree");
    expect(separatorIdOf(horizontal, all, "editorpdf", "assistant")).toBe("h-assistant");
    expect(separatorIdOf(horizontal, ["sidebar", "assistant"], "sidebar", "assistant")).toBe("h-tree");
    expect(separatorIdOf(document, ["editor", "pdf"], "editor", "pdf")).toBe("h-mid");
  });

  it("names moved groups after the panes they hold", () => {
    const moved = movePane(DEFAULT_PANE_LAYOUT, "terminal", { kind: "pane", pane: "pdf", side: "bottom" });
    const stack = parentSplitOf(moved, "terminal") as PaneSplit;
    expect(groupNameOf(stack)).toBe("split-pdf-terminal");
    expect(panelIdOf(stack)).toBe("panes-pdf-terminal");
    expect(legacyGroupOf(stack)).toBeNull();
    expect(storageOrderOf(stack)).toEqual(["pdf", "terminal"]);
    expect(groupDomIdOf(stack)).toBe("oleafly-panes-split-pdf-terminal-pdf-terminal");
    expect(separatorIdOf(stack, ["pdf", "terminal"], "pdf", "terminal")).toBe("sep-pdf-terminal");

    const reordered = movePane(DEFAULT_PANE_LAYOUT, "sidebar", { kind: "pane", pane: "assistant", side: "right" });
    const horizontal = band(reordered);
    expect(groupNameOf(horizontal)).toBe("horizontal");
    expect(storageOrderOf(horizontal)).toEqual(["sidebar", "editorpdf", "assistant"]);
    expect(groupDomIdOf(horizontal)).toBe("oleafly-panes-horizontal-editorpdf-assistant-sidebar");
  });

  it("gives the sidebar and the assistant their own separator when they sit side by side", () => {
    const moved = movePane(DEFAULT_PANE_LAYOUT, "assistant", { kind: "pane", pane: "sidebar", side: "right" });
    const horizontal = band(moved);
    expect(key(moved)).toBe("column(row(sidebar,assistant,row(editor,pdf)),terminal)");
    expect(separatorIdOf(horizontal, ["sidebar", "assistant", "editorpdf"], "sidebar", "assistant")).toBe(
      "h-side-assistant",
    );
  });
});

describe("moving a pane", () => {
  it.each([
    ["assistant", "editor", "left", "column(row(sidebar,row(assistant,editor,pdf)),terminal)"],
    ["assistant", "pdf", "right", "column(row(sidebar,row(editor,pdf,assistant)),terminal)"],
    ["terminal", "pdf", "bottom", "row(sidebar,row(editor,column(pdf,terminal)),assistant)"],
    ["terminal", "editor", "top", "row(sidebar,row(column(terminal,editor),pdf),assistant)"],
    ["sidebar", "terminal", "right", "column(row(row(editor,pdf),assistant),row(terminal,sidebar))"],
    ["editor", "assistant", "top", "column(row(sidebar,pdf,column(editor,assistant)),terminal)"],
    ["sidebar", "assistant", "top", "column(row(row(editor,pdf),column(sidebar,assistant)),terminal)"],
    ["assistant", "terminal", "left", "column(row(sidebar,row(editor,pdf)),row(assistant,terminal))"],
  ] as const)("puts %s beside %s on the %s", (pane, target, side, expected) => {
    const moved = movePane(DEFAULT_PANE_LAYOUT, pane, { kind: "pane", pane: target, side });
    expect(key(moved)).toBe(expected);
    sizesAddUp(moved);
  });

  it.each([
    ["sidebar", "left", "row(sidebar,column(row(row(editor,pdf),assistant),terminal))"],
    ["assistant", "right", "row(column(row(sidebar,row(editor,pdf)),terminal),assistant)"],
    ["assistant", "bottom", "column(row(sidebar,row(editor,pdf)),terminal,assistant)"],
    ["terminal", "top", "column(terminal,row(sidebar,row(editor,pdf),assistant))"],
    ["terminal", "bottom", DEFAULT_KEY],
  ] as const)("puts %s along the %s window edge", (pane, side, expected) => {
    const moved = movePane(DEFAULT_PANE_LAYOUT, pane, { kind: "edge", side });
    expect(key(moved)).toBe(expected);
    sizesAddUp(moved);
  });

  it("gives an edge pane a quarter and keeps the rest in proportion", () => {
    const moved = movePane(DEFAULT_PANE_LAYOUT, "assistant", { kind: "edge", side: "bottom" });
    expect(moved.sizes).toEqual([54, 21, 25]);
    const wrapped = insertAtEdge({ pane: "editor" }, "left", { pane: "pdf" });
    expect(wrapped.sizes).toEqual([25, 75]);
  });

  it("splits the target's share in half", () => {
    const moved = movePane(DEFAULT_PANE_LAYOUT, "assistant", { kind: "pane", pane: "pdf", side: "right" });
    const document = band(moved).children[1] as PaneSplit;
    expect(document.sizes).toEqual([50, 25, 25]);
  });

  it("reorders inside the same split without breaking it up", () => {
    const swapped = movePane(DEFAULT_PANE_LAYOUT, "editor", { kind: "pane", pane: "pdf", side: "right" });
    expect(key(swapped)).toBe("column(row(sidebar,row(pdf,editor),assistant),terminal)");
    const back = movePane(swapped, "editor", { kind: "pane", pane: "pdf", side: "left" });
    expect(key(back)).toBe(DEFAULT_KEY);
    expect(movePane(DEFAULT_PANE_LAYOUT, "editor", { kind: "pane", pane: "pdf", side: "left" })).toBe(
      DEFAULT_PANE_LAYOUT,
    );
  });

  it("stacks two siblings in place and keeps them as the document group", () => {
    const stacked = movePane(DEFAULT_PANE_LAYOUT, "editor", { kind: "pane", pane: "pdf", side: "top" });
    expect(key(stacked)).toBe("column(row(sidebar,column(editor,pdf),assistant),terminal)");
    const document = band(stacked).children[1] as PaneSplit;
    expect([groupNameOf(document), panelIdOf(document)]).toEqual(["document", "editorpdf"]);
    expect(groupDomIdOf(document)).toBeUndefined();
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
    expect(key(rest)).toBe("column(row(sidebar,editor,assistant),terminal)");
    sizesAddUp(rest);
    const alone = removePane({ direction: "row", children: [{ pane: "editor" }], sizes: [100] }, "editor");
    expect(alone).toBeNull();
  });

  it("swaps two panes in place", () => {
    expect(key(swapPanes(DEFAULT_PANE_LAYOUT, "editor", "pdf"))).toBe(
      "column(row(sidebar,row(pdf,editor),assistant),terminal)",
    );
    expect(key(swapPanes(DEFAULT_PANE_LAYOUT, "sidebar", "terminal"))).toBe(
      "column(row(terminal,row(editor,pdf),assistant),sidebar)",
    );
  });
});

describe("reading a saved layout", () => {
  it("falls back to the default for missing or broken values", () => {
    for (const raw of [null, "", "nope", "null", "[]", "42", '{"direction":"diagonal","children":[]}']) {
      expect(parsePaneLayout(raw)).toBe(DEFAULT_PANE_LAYOUT);
    }
  });

  it("keeps a valid tree", () => {
    const moved = movePane(DEFAULT_PANE_LAYOUT, "terminal", { kind: "pane", pane: "pdf", side: "bottom" });
    expect(parsePaneLayout(JSON.stringify(moved))).toEqual(moved);
  });

  it("drops unknown and repeated panes and adds the missing ones where they normally go", () => {
    const raw = JSON.stringify({
      direction: "row",
      children: [{ pane: "editor" }, { pane: "pdf" }, { pane: "pdf" }, { pane: "outline" }, "junk"],
      sizes: [1, 1, 1, 1, 1],
    });
    const layout = parsePaneLayout(raw);
    expect(key(layout)).toBe("column(row(sidebar,row(editor,pdf),assistant),terminal)");
    expect(layout).toBe(DEFAULT_PANE_LAYOUT);

    const partial = parsePaneLayout(
      JSON.stringify({ direction: "column", children: [{ pane: "assistant" }, { pane: "terminal" }], sizes: [60, 40] }),
    );
    expect(key(partial)).toBe("column(row(sidebar,editor,pdf,assistant),terminal)");
    sizesAddUp(partial);
  });

  it("repairs bad sizes and collapses splits with one child", () => {
    const raw = JSON.stringify({
      direction: "column",
      sizes: ["a"],
      children: [
        {
          direction: "row",
          sizes: [-1, 2, 3],
          children: [{ pane: "sidebar" }, { direction: "row", children: [{ pane: "editor" }], sizes: [] }, { pane: "pdf" }],
        },
        { direction: "row", children: [], sizes: [] },
        { pane: "assistant" },
        { pane: "terminal" },
      ],
    });
    const layout = parsePaneLayout(raw);
    expect(key(layout)).toBe("column(row(sidebar,editor,pdf),assistant,terminal)");
    sizesAddUp(layout);
    expect(normalizeSizes([1, 3], 2)).toEqual([25, 75]);
    expect(normalizeSizes([1], 2)).toEqual([50, 50]);
  });

  it("places missing panes beside whatever is left", () => {
    expect(key(parsePaneLayout(JSON.stringify({ pane: "sidebar" })))).toBe(
      "column(row(sidebar,editor,pdf,assistant),terminal)",
    );
    expect(key(parsePaneLayout(JSON.stringify({ pane: "terminal" })))).toBe("row(terminal,sidebar,editor,pdf,assistant)");
  });
});

describe("what shows on screen", () => {
  it("keeps the terminal in its group while a sibling shows", () => {
    const shown: PaneShown = { ...ALL_SHOWN, terminal: false, assistant: false };
    expect(renderedChildren(DEFAULT_PANE_LAYOUT, shown).map(panelIdOf)).toEqual(["content-band", "terminal"]);
    expect(renderedChildren(band(DEFAULT_PANE_LAYOUT), shown).map(panelIdOf)).toEqual(["sidebar", "editorpdf"]);
  });

  it("hides a split whose panes are all hidden", () => {
    const moved = movePane(DEFAULT_PANE_LAYOUT, "terminal", { kind: "pane", pane: "assistant", side: "bottom" });
    const stack = parentSplitOf(moved, "assistant") as PaneSplit;
    const closed: PaneShown = { ...ALL_SHOWN, terminal: false, assistant: false };
    expect(nodeShown(stack, closed)).toBe(false);
    expect(nodeShown(stack, { ...closed, terminal: true })).toBe(true);
    expect(renderedChildren(moved, closed).map(panelIdOf)).toEqual(["sidebar", "editorpdf"]);
  });

  it("tells which side of the document the sidebar and the assistant sit on", () => {
    expect(paneSide(DEFAULT_PANE_LAYOUT, "sidebar")).toBe("left");
    expect(paneSide(DEFAULT_PANE_LAYOUT, "assistant")).toBe("right");
    const flipped = movePane(
      movePane(DEFAULT_PANE_LAYOUT, "sidebar", { kind: "pane", pane: "assistant", side: "right" }),
      "assistant",
      { kind: "edge", side: "left" },
    );
    expect(paneSide(flipped, "sidebar")).toBe("right");
    expect(paneSide(flipped, "assistant")).toBe("left");
    const stacked = movePane(DEFAULT_PANE_LAYOUT, "sidebar", { kind: "pane", pane: "terminal", side: "top" });
    expect(paneSide(stacked, "sidebar")).toBe("left");
    expect(paneSide(removePane(DEFAULT_PANE_LAYOUT, "assistant") as PaneSplit, "assistant")).toBe("right");
  });
});

describe("pane layout store", () => {
  it("saves a moved layout and forgets it when the layout is back to default", () => {
    movePaneToEdge("assistant", "left");
    expect(paneLayoutIsDefault()).toBe(false);
    expect(parsePaneLayout(localStorage.getItem(PANE_LAYOUT_KEY))).toEqual(usePaneLayoutStore.getState().layout);
    resetPaneLayout();
    expect(usePaneLayoutStore.getState().layout).toBe(DEFAULT_PANE_LAYOUT);
    expect(localStorage.getItem(PANE_LAYOUT_KEY)).toBeNull();
  });

  it("swaps the editor and the preview and skips changes that keep the layout", () => {
    swapEditorAndPreview();
    expect(key(usePaneLayoutStore.getState().layout)).toBe("column(row(sidebar,row(pdf,editor),assistant),terminal)");
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
    expect(key(usePaneLayoutStore.getState().layout)).toBe("column(terminal,row(sidebar,row(editor,pdf),assistant))");
    resetPaneLayout();
    expect(usePaneLayoutStore.getState().layout).toBe(DEFAULT_PANE_LAYOUT);
  });

  it("starts from the saved layout", async () => {
    const moved = movePane(DEFAULT_PANE_LAYOUT, "terminal", { kind: "edge", side: "right" });
    localStorage.setItem(PANE_LAYOUT_KEY, JSON.stringify(moved));
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
