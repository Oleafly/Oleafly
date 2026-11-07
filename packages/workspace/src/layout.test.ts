import { describe, expect, it, vi } from "vitest";
import {
  activate,
  closeGroup,
  closeView,
  createLayout,
  evenPair,
  findNode,
  group,
  groupOfView,
  groupsOf,
  MIN_WEIGHT,
  moveView,
  nextId,
  normalize,
  openView,
  parseLayout,
  resizeSplit,
  sameLayout,
  split,
  toggleMaximize,
  type GroupNode,
  type LayoutNode,
  type SplitNode,
  type ViewState,
  type WorkspaceLayout,
} from "./layout";

function views(...ids: string[]): Record<string, ViewState> {
  return Object.fromEntries(ids.map((id) => [id, { type: "note", params: { id } }]));
}

function twoGroups(): WorkspaceLayout {
  return createLayout(split("s1", "row", [group("g1", ["a", "b"]), group("g2", ["c"])]), views("a", "b", "c"));
}

function single(...ids: string[]): WorkspaceLayout {
  return createLayout(group("g1", ids), views(...ids));
}

function asSplit(node: LayoutNode | null): SplitNode {
  if (!node || node.kind !== "split") throw new Error("expected a split");
  return node;
}

function asGroup(node: LayoutNode | null): GroupNode {
  if (!node || node.kind !== "group") throw new Error("expected a group");
  return node;
}

function shape(node: LayoutNode): unknown {
  if (node.kind === "group") return { [node.id]: node.views, active: node.active };
  return { [node.id]: node.direction, weights: node.weights.map((weight) => Number(weight.toFixed(4))), children: node.children.map(shape) };
}

function visibleViews(layout: WorkspaceLayout): string[] {
  const shown = layout.maximized ? findNode(layout.root, layout.maximized) : layout.root;
  return shown ? groupsOf(shown).flatMap((candidate) => candidate.views) : [];
}

function chain(depth: number): unknown {
  if (depth === 0) return { kind: "group", id: "g1", views: ["a"], active: "a" };
  return { kind: "split", id: `s${depth}`, direction: "row", children: [chain(depth - 1)], weights: [1] };
}

function nested(depth: number): unknown {
  return depth === 0 ? 1 : { inner: nested(depth - 1) };
}

describe("nextId", () => {
  it("starts at 1 when no id is numbered", () => {
    expect(nextId(group("main", []), "g")).toBe("g1");
    expect(nextId(group("main", []), "s")).toBe("s1");
  });

  it("counts group and split numbers together so ids never collide", () => {
    const root = split("s5", "row", [group("g2", ["a"]), group("g9x", ["b"]), group("x3", ["c"])]);
    expect(nextId(root, "g")).toBe("g6");
    expect(nextId(root, "s")).toBe("s6");
  });

  it("looks into nested splits", () => {
    const root = split("s1", "row", [group("g1", []), split("s2", "column", [group("g12", []), group("g3", [])])]);
    expect(nextId(root, "g")).toBe("g13");
  });
});

describe("group", () => {
  it("activates the first view by default and copies the views", () => {
    const source = ["a", "b"];
    const node = group("g1", source);
    source.push("c");
    expect(node).toEqual({ kind: "group", id: "g1", views: ["a", "b"], active: "a" });
  });

  it("keeps a valid active view and falls back when the active view is missing", () => {
    expect(group("g1", ["a", "b"], "b").active).toBe("b");
    expect(group("g1", ["a", "b"], "z").active).toBe("a");
    expect(group("g1", ["a", "b"], null).active).toBe("a");
    expect(group("g1", []).active).toBeNull();
    expect(group("g1", [], "a").active).toBeNull();
  });
});

describe("split", () => {
  it("shares space equally by default", () => {
    expect(split("s1", "row", [group("g1", []), group("g2", [])]).weights).toEqual([0.5, 0.5]);
  });

  it("normalizes weights and replaces unusable ones with 1", () => {
    const node = split("s1", "column", [group("g1", []), group("g2", []), group("g3", []), group("g4", []), group("g5", [])], [
      2,
      Number.NaN,
      -1,
      0,
    ]);
    expect(node.weights).toEqual([2 / 6, 1 / 6, 1 / 6, 1 / 6, 1 / 6]);
    expect(split("s2", "row", [group("g1", []), group("g2", [])], [Infinity, 3]).weights).toEqual([0.25, 0.75]);
  });

  it("copies the children", () => {
    const children = [group("g1", [])];
    const node = split("s1", "row", children);
    children.push(group("g2", []));
    expect(node.children).toHaveLength(1);
  });
});

describe("createLayout", () => {
  it("builds a normalized schema 1 layout", () => {
    const layout = createLayout(split("s1", "row", [group("g1", ["a", "ghost"]), group("g2", [])]), views("a", "spare"));
    expect(layout).toEqual({
      schema: 1,
      root: { kind: "group", id: "g1", views: ["a"], active: "a" },
      views: { a: { type: "note", params: { id: "a" } } },
      maximized: null,
    });
  });

  it("copies the views record", () => {
    const record = views("a");
    const layout = createLayout(group("g1", ["a"]), record);
    record.b = { type: "note" };
    expect(Object.keys(layout.views)).toEqual(["a"]);
  });
});

describe("tree queries", () => {
  const root = split("s1", "row", [group("g1", ["a"]), split("s2", "column", [group("g2", ["b"]), group("g3", ["c"])])]);
  const layout = createLayout(root, views("a", "b", "c"));

  it("lists groups depth first", () => {
    expect(groupsOf(layout.root).map((node) => node.id)).toEqual(["g1", "g2", "g3"]);
    expect(groupsOf(group("solo", []))).toHaveLength(1);
  });

  it("finds nodes at any depth", () => {
    expect(findNode(layout.root, "s1")).toBe(layout.root);
    expect(findNode(layout.root, "s2")?.kind).toBe("split");
    expect(findNode(layout.root, "g3")?.id).toBe("g3");
    expect(findNode(layout.root, "nope")).toBeNull();
    expect(findNode(group("g1", []), "g2")).toBeNull();
  });

  it("finds the group showing a view", () => {
    expect(groupOfView(layout, "c")?.id).toBe("g3");
    expect(groupOfView(layout, "zzz")).toBeNull();
  });
});

describe("normalize", () => {
  it("drops unknown views and keeps the first copy of a duplicate", () => {
    const layout = normalize({
      schema: 1,
      root: split("s1", "row", [group("g1", ["a", "x", "b"]), group("g2", ["b", "c", "a"], "a")]),
      views: views("a", "b", "c"),
      maximized: null,
    });
    expect(shape(layout.root)).toEqual({
      s1: "row",
      weights: [0.5, 0.5],
      children: [{ g1: ["a", "b"], active: "a" }, { g2: ["c"], active: "c" }],
    });
  });

  it("drops view states no group shows and keeps the remaining state objects", () => {
    const record = views("a", "b", "orphan");
    const layout = normalize({ schema: 1, root: group("g1", ["b", "a"]), views: record, maximized: null });
    expect(Object.keys(layout.views)).toEqual(["b", "a"]);
    expect(layout.views.a).toBe(record.a);
  });

  it("removes empty groups and collapses a split left with one child", () => {
    const layout = normalize({
      schema: 1,
      root: split("s1", "row", [group("g1", []), split("s2", "column", [group("g2", ["a"]), group("g3", ["b"])])]),
      views: views("a", "b"),
      maximized: null,
    });
    expect(shape(layout.root)).toEqual({
      s2: "column",
      weights: [0.5, 0.5],
      children: [{ g2: ["a"], active: "a" }, { g3: ["b"], active: "b" }],
    });
  });

  it("drops a nested split whose groups are all empty and hands its space to the next sibling", () => {
    const layout = normalize({
      schema: 1,
      root: split("s1", "row", [group("g1", ["a"]), split("s2", "column", [group("g2", ["x"]), group("g3", [])]), group("g4", ["b"])]),
      views: views("a", "b"),
      maximized: null,
    });
    expect(shape(layout.root)).toEqual({
      s1: "row",
      weights: [expect.closeTo(1 / 3), expect.closeTo(2 / 3)],
      children: [{ g1: ["a"], active: "a" }, { g4: ["b"], active: "b" }],
    });
  });

  it("flattens a nested split that runs the same way, multiplying weights", () => {
    const inner = split("s2", "row", [group("g2", ["b"]), group("g3", ["c"])], [1, 3]);
    const layout = normalize({
      schema: 1,
      root: split("s1", "row", [group("g1", ["a"]), inner], [1, 1]),
      views: views("a", "b", "c"),
      maximized: null,
    });
    expect(shape(layout.root)).toEqual({
      s1: "row",
      weights: [0.5, 0.125, 0.375],
      children: [
        { g1: ["a"], active: "a" },
        { g2: ["b"], active: "b" },
        { g3: ["c"], active: "c" },
      ],
    });
  });

  it("flattens a split that becomes same-direction after its own child collapses", () => {
    const layout = normalize({
      schema: 1,
      root: split("s1", "row", [group("g1", ["a"]), split("s2", "column", [split("s3", "row", [group("g2", ["b"]), group("g3", ["c"])]), group("g4", [])])]),
      views: views("a", "b", "c"),
      maximized: null,
    });
    expect(asSplit(layout.root).children.map((child) => child.id)).toEqual(["g1", "g2", "g3"]);
    expect(asSplit(layout.root).weights).toEqual([0.5, 0.25, 0.25]);
  });

  it("keeps splits that run the other way", () => {
    const layout = twoGroups();
    const nestedLayout = normalize({
      ...layout,
      root: split("s1", "row", [group("g1", ["a"]), split("s2", "column", [group("g2", ["b"]), group("g3", ["c"])])]),
    });
    expect(asSplit(nestedLayout.root).children[1].kind).toBe("split");
  });

  it("treats a missing weight as 1", () => {
    const raw: SplitNode = { kind: "split", id: "s1", direction: "row", children: [group("g1", ["a"]), group("g2", ["b"]), group("g3", ["c"])], weights: [2] };
    const layout = normalize({ schema: 1, root: raw, views: views("a", "b", "c"), maximized: null });
    expect(asSplit(layout.root).weights).toEqual([0.5, 0.25, 0.25]);
  });

  it("fixes an active view that is no longer in its group", () => {
    const layout = normalize({ schema: 1, root: { kind: "group", id: "g1", views: ["a", "b"], active: "gone" }, views: views("a", "b"), maximized: null });
    expect(asGroup(layout.root).active).toBe("a");
  });

  it("keeps an empty root group", () => {
    const layout = normalize({ schema: 1, root: group("g7", ["x"]), views: {}, maximized: null });
    expect(layout.root).toEqual({ kind: "group", id: "g7", views: [], active: null });
  });

  it("turns a root split with no views left into an empty group", () => {
    const layout = normalize({ schema: 1, root: split("s4", "row", [group("g1", ["x"]), group("g2", [])]), views: {}, maximized: null });
    expect(layout.root).toEqual({ kind: "group", id: "s4", views: [], active: null });
  });

  it("keeps a maximized group and clears a maximized id that is not a group", () => {
    const layout = twoGroups();
    expect(normalize({ ...layout, maximized: "g2" }).maximized).toBe("g2");
    expect(normalize({ ...layout, maximized: "s1" }).maximized).toBeNull();
    expect(normalize({ ...layout, maximized: "missing" }).maximized).toBeNull();
  });

  it("keeps unchanged groups as the same objects", () => {
    const root = group("g1", ["a"]);
    expect(normalize({ schema: 1, root, views: views("a"), maximized: null }).root).toBe(root);
  });
});

describe("activate", () => {
  it("activates a view in its group", () => {
    const next = activate(twoGroups(), "b");
    expect(groupOfView(next, "b")?.active).toBe("b");
    expect(groupOfView(next, "c")?.active).toBe("c");
  });

  it("returns the same layout when nothing changes", () => {
    const layout = twoGroups();
    expect(activate(layout, "a")).toBe(layout);
    expect(activate(layout, "nope")).toBe(layout);
  });
});

describe("closeView", () => {
  it("activates the tab to the right of the closed active tab", () => {
    const layout = activate(single("a", "b", "c"), "b");
    const next = closeView(layout, "b");
    expect(asGroup(next.root)).toMatchObject({ views: ["a", "c"], active: "c" });
    expect(next.views).not.toHaveProperty("b");
  });

  it("activates the tab to the left when the last tab closes", () => {
    const layout = activate(single("a", "b", "c"), "c");
    expect(asGroup(closeView(layout, "c").root)).toMatchObject({ views: ["a", "b"], active: "b" });
  });

  it("keeps the active tab when an inactive tab closes", () => {
    const layout = activate(single("a", "b", "c"), "c");
    expect(asGroup(closeView(layout, "a").root)).toMatchObject({ views: ["b", "c"], active: "c" });
  });

  it("removes a group whose last view closes and collapses the split", () => {
    const next = closeView(twoGroups(), "c");
    expect(shape(next.root)).toEqual({ g1: ["a", "b"], active: "a" });
  });

  it("leaves an empty root group when the last view closes", () => {
    const next = closeView(single("a"), "a");
    expect(next.root).toEqual({ kind: "group", id: "g1", views: [], active: null });
    expect(next.views).toEqual({});
  });

  it("returns the same layout for an unknown view", () => {
    const layout = twoGroups();
    expect(closeView(layout, "nope")).toBe(layout);
  });

  it("drops the state of a view that no group shows", () => {
    const raw: WorkspaceLayout = { schema: 1, root: group("g1", ["a"]), views: views("a", "loose"), maximized: null };
    expect(Object.keys(closeView(raw, "loose").views)).toEqual(["a"]);
  });

  it("clears maximize when the maximized group closes", () => {
    const layout = toggleMaximize(twoGroups(), "g2");
    expect(closeView(layout, "c").maximized).toBeNull();
  });
});

describe("closeGroup", () => {
  function threeGroups(stage: string | null = null): WorkspaceLayout {
    return createLayout(
      split("s1", "row", [group("g1", ["a", "b"]), split("s2", "column", [group("g2", ["c"]), group("g3", ["d"])], [0.5, 0.5])], [0.5, 0.5]),
      views("a", "b", "c", "d"),
      stage,
    );
  }

  it("removes a group with its views and collapses the split around it", () => {
    const next = closeGroup(threeGroups(), "g2");
    expect(shape(next.root)).toEqual({
      s1: "row",
      weights: [0.5, 0.5],
      children: [{ g1: ["a", "b"], active: "a" }, { g3: ["d"], active: "d" }],
    });
    expect(Object.keys(next.views)).toEqual(["a", "b", "d"]);
    expect("stage" in next).toBe(false);
  });

  it("removes an empty stage group and hands the stage to the first group it prefers", () => {
    const emptied = closeView(threeGroups("g1"), "a");
    const layout = closeView(emptied, "b");
    expect(findNode(layout.root, "g1")).toMatchObject({ views: [], active: null });
    const prefer = (candidate: GroupNode) => candidate.views.includes("d");
    const next = closeGroup(layout, "g1", prefer);
    expect(next.stage).toBe("g3");
    expect(findNode(next.root, "g1")).toBeNull();
    expect(groupsOf(next.root).map((candidate) => candidate.views)).toEqual([["c"], ["d"]]);
  });

  it("hands the stage to the first remaining group when none is preferred", () => {
    expect(closeGroup(threeGroups("g1"), "g1", () => false).stage).toBe("g2");
    expect(closeGroup(threeGroups("g1"), "g1").stage).toBe("g2");
    expect(closeGroup(threeGroups("g3"), "g3").stage).toBe("g1");
  });

  it("keeps the stage when another group closes", () => {
    const prefer = vi.fn(() => true);
    const next = closeGroup(threeGroups("g3"), "g1", prefer);
    expect(next.stage).toBe("g3");
    expect(prefer).not.toHaveBeenCalled();
  });

  it("clears maximize when the maximized group closes and keeps it otherwise", () => {
    const layout = toggleMaximize(threeGroups(), "g2");
    expect(closeGroup(layout, "g2").maximized).toBeNull();
    expect(closeGroup(layout, "g3").maximized).toBe("g2");
  });

  it("never removes the last group", () => {
    const layout = single("a");
    expect(closeGroup(layout, "g1")).toBe(layout);
    const empty = createLayout(group("g1", []), {}, "g1");
    expect(closeGroup(empty, "g1")).toBe(empty);
  });

  it("returns the same layout for an id that is not a group", () => {
    const layout = threeGroups();
    expect(closeGroup(layout, "s2")).toBe(layout);
    expect(closeGroup(layout, "nope")).toBe(layout);
  });
});

describe("openView", () => {
  const view: ViewState = { type: "note", params: { id: "d" } };

  it("activates a view that is already open and keeps its state", () => {
    const layout = twoGroups();
    const next = openView(layout, "b", { type: "other" }, { groupId: "g2", zone: "center" });
    expect(groupOfView(next, "b")?.id).toBe("g1");
    expect(groupOfView(next, "b")?.active).toBe("b");
    expect(next.views.b).toBe(layout.views.b);
    expect(openView(next, "b", view, { groupId: "g2", zone: "right" })).toBe(next);
  });

  it("adds a view to the end of the target group and activates it", () => {
    const next = openView(twoGroups(), "d", view, { groupId: "g1", zone: "center" });
    expect(groupOfView(next, "d")).toMatchObject({ id: "g1", views: ["a", "b", "d"], active: "d" });
    expect(next.views.d).toEqual(view);
  });

  it("inserts at an index and clamps it to the tab range", () => {
    expect(groupOfView(openView(twoGroups(), "d", view, { groupId: "g1", zone: "center", index: 1 }), "d")?.views).toEqual(["a", "d", "b"]);
    expect(groupOfView(openView(twoGroups(), "d", view, { groupId: "g1", zone: "center", index: -4 }), "d")?.views).toEqual(["d", "a", "b"]);
    expect(groupOfView(openView(twoGroups(), "d", view, { groupId: "g1", zone: "center", index: 99 }), "d")?.views).toEqual(["a", "b", "d"]);
  });

  it("opens a new group on each edge of a lone group", () => {
    const base = single("a");
    expect(shape(openView(base, "d", view, { groupId: "g1", zone: "right" }).root)).toEqual({
      s2: "row",
      weights: [0.5, 0.5],
      children: [{ g1: ["a"], active: "a" }, { g2: ["d"], active: "d" }],
    });
    expect(shape(openView(base, "d", view, { groupId: "g1", zone: "left" }).root)).toEqual({
      s2: "row",
      weights: [0.5, 0.5],
      children: [{ g2: ["d"], active: "d" }, { g1: ["a"], active: "a" }],
    });
    expect(shape(openView(base, "d", view, { groupId: "g1", zone: "top" }, 0.3).root)).toEqual({
      s2: "column",
      weights: [0.3, 0.7],
      children: [{ g2: ["d"], active: "d" }, { g1: ["a"], active: "a" }],
    });
    expect(shape(openView(base, "d", view, { groupId: "g1", zone: "bottom" }, 0.3).root)).toEqual({
      s2: "column",
      weights: [0.7, 0.3],
      children: [{ g1: ["a"], active: "a" }, { g2: ["d"], active: "d" }],
    });
  });

  it("clamps the share of a new group", () => {
    const base = single("a");
    expect(asSplit(openView(base, "d", view, { groupId: "g1", zone: "right" }, 0).root).weights[1]).toBeCloseTo(MIN_WEIGHT);
    expect(asSplit(openView(base, "d", view, { groupId: "g1", zone: "right" }, 1).root).weights[1]).toBeCloseTo(1 - MIN_WEIGHT);
    expect(asSplit(openView(base, "d", view, { groupId: "g1", zone: "right" }, Number.NaN).root).weights[1]).toBeCloseTo(0.5);
  });

  it("splits the target's share when its parent runs the same way", () => {
    const next = openView(twoGroups(), "d", view, { groupId: "g1", zone: "right" });
    expect(shape(next.root)).toEqual({
      s1: "row",
      weights: [0.25, 0.25, 0.5],
      children: [
        { g1: ["a", "b"], active: "a" },
        { g3: ["d"], active: "d" },
        { g2: ["c"], active: "c" },
      ],
    });
    const before = openView(twoGroups(), "d", view, { groupId: "g2", zone: "left" }, 0.2);
    expect(asSplit(before.root).children.map((child) => child.id)).toEqual(["g1", "g3", "g2"]);
    expect(asSplit(before.root).weights.map((weight) => Number(weight.toFixed(4)))).toEqual([0.5, 0.1, 0.4]);
  });

  it("nests a split when the parent runs the other way", () => {
    const next = openView(twoGroups(), "d", view, { groupId: "g2", zone: "bottom" });
    expect(shape(next.root)).toEqual({
      s1: "row",
      weights: [0.5, 0.5],
      children: [
        { g1: ["a", "b"], active: "a" },
        { s3: "column", weights: [0.5, 0.5], children: [{ g2: ["c"], active: "c" }, { g3: ["d"], active: "d" }] },
      ],
    });
  });

  it("finds a target deep in the tree", () => {
    const layout = createLayout(
      split("s1", "row", [group("g1", ["a"]), split("s2", "column", [group("g2", ["b"]), group("g3", ["c"])])]),
      views("a", "b", "c"),
    );
    const next = openView(layout, "d", view, { groupId: "g3", zone: "bottom" });
    const column = asSplit(asSplit(next.root).children[1]);
    expect(column.children.map((child) => child.id)).toEqual(["g2", "g3", "g4"]);
  });

  it("falls back to the first group when the target is missing or not a group", () => {
    expect(groupOfView(openView(twoGroups(), "d", view, { groupId: "nope", zone: "center" }), "d")?.id).toBe("g1");
    expect(groupOfView(openView(twoGroups(), "d", view, { groupId: "s1", zone: "center" }), "d")?.id).toBe("g1");
  });

  it("fills an empty root group", () => {
    const empty = createLayout(group("g1", []), {});
    expect(asGroup(openView(empty, "d", view, { groupId: "g1", zone: "center" }).root)).toMatchObject({ id: "g1", views: ["d"], active: "d" });
    expect(asGroup(openView(empty, "d", view, { groupId: "g1", zone: "right" }).root)).toMatchObject({ id: "g2", views: ["d"] });
  });

  it("re-adds a view whose state exists but that no group shows", () => {
    const raw: WorkspaceLayout = { schema: 1, root: group("g1", ["a"]), views: views("a", "loose"), maximized: null };
    expect(groupOfView(openView(raw, "loose", view, { groupId: "g1", zone: "center" }), "loose")?.id).toBe("g1");
  });

  it("opens a view beside the maximized group and restores the layout so it shows", () => {
    const layout = toggleMaximize(twoGroups(), "g1");
    const next = openView(layout, "d", view, { groupId: "g1", zone: "right" });
    expect(visibleViews(next)).toContain("d");
  });
});

describe("moveView", () => {
  it("reorders within a group, adjusting for the removed tab", () => {
    const base = single("a", "b", "c");
    expect(asGroup(moveView(base, "a", { groupId: "g1", zone: "center", index: 2 }).root)).toMatchObject({ views: ["b", "a", "c"], active: "a" });
    expect(asGroup(moveView(base, "a", { groupId: "g1", zone: "center", index: 3 }).root).views).toEqual(["b", "c", "a"]);
    expect(asGroup(moveView(base, "c", { groupId: "g1", zone: "center", index: 0 }).root).views).toEqual(["c", "a", "b"]);
    expect(asGroup(moveView(base, "a", { groupId: "g1", zone: "center" }).root).views).toEqual(["b", "c", "a"]);
    expect(asGroup(moveView(base, "b", { groupId: "g1", zone: "center", index: -5 }).root).views).toEqual(["b", "a", "c"]);
  });

  it("only activates a tab dropped back where it was", () => {
    const base = single("a", "b", "c");
    expect(moveView(base, "a", { groupId: "g1", zone: "center", index: 0 })).toBe(base);
    expect(moveView(base, "a", { groupId: "g1", zone: "center", index: 1 })).toBe(base);
    const moved = moveView(base, "b", { groupId: "g1", zone: "center", index: 2 });
    expect(asGroup(moved.root)).toMatchObject({ views: ["a", "b", "c"], active: "b" });
  });

  it("moves a view into another group", () => {
    const next = moveView(twoGroups(), "a", { groupId: "g2", zone: "center", index: 0 });
    expect(shape(next.root)).toEqual({
      s1: "row",
      weights: [0.5, 0.5],
      children: [{ g1: ["b"], active: "b" }, { g2: ["a", "c"], active: "a" }],
    });
  });

  it("removes the source group when its only view leaves", () => {
    const next = moveView(twoGroups(), "c", { groupId: "g1", zone: "center" });
    expect(shape(next.root)).toEqual({ g1: ["a", "b", "c"], active: "c" });
  });

  it("splits a view off to the edge of another group", () => {
    const next = moveView(twoGroups(), "a", { groupId: "g2", zone: "top" }, 0.25);
    expect(shape(next.root)).toEqual({
      s1: "row",
      weights: [0.5, 0.5],
      children: [
        { g1: ["b"], active: "b" },
        { s3: "column", weights: [0.25, 0.75], children: [{ g3: ["a"], active: "a" }, { g2: ["c"], active: "c" }] },
      ],
    });
  });

  it("splits a view off its own group", () => {
    const next = moveView(single("a", "b"), "b", { groupId: "g1", zone: "left" });
    expect(shape(next.root)).toEqual({
      s2: "row",
      weights: [0.5, 0.5],
      children: [{ g2: ["b"], active: "b" }, { g1: ["a"], active: "a" }],
    });
  });

  it("does nothing when a group's only view moves to its own edge", () => {
    const layout = twoGroups();
    expect(moveView(layout, "c", { groupId: "g2", zone: "right" })).toBe(layout);
  });

  it("returns the same layout for an unknown view or target", () => {
    const layout = twoGroups();
    expect(moveView(layout, "nope", { groupId: "g1", zone: "center" })).toBe(layout);
    expect(moveView(layout, "a", { groupId: "nope", zone: "center" })).toBe(layout);
    expect(moveView(layout, "a", { groupId: "s1", zone: "center" })).toBe(layout);
  });

  it("clamps the share of a split-off group", () => {
    const next = moveView(single("a", "b"), "b", { groupId: "g1", zone: "right" }, 5);
    expect(asSplit(next.root).weights[1]).toBeCloseTo(1 - MIN_WEIGHT);
  });

  it("clears maximize when the maximized group empties", () => {
    const layout = toggleMaximize(twoGroups(), "g2");
    expect(moveView(layout, "c", { groupId: "g1", zone: "center" }).maximized).toBeNull();
  });
});

describe("resizeSplit", () => {
  it("normalizes the new weights", () => {
    const next = resizeSplit(twoGroups(), "s1", [3, 1]);
    expect(asSplit(next.root).weights).toEqual([0.75, 0.25]);
  });

  it("raises weights below the minimum before normalizing", () => {
    const next = resizeSplit(twoGroups(), "s1", [0.01, 0.92]);
    const second = 0.92 / 0.93;
    expect(asSplit(next.root).weights).toEqual([
      expect.closeTo(MIN_WEIGHT / (MIN_WEIGHT + second)),
      expect.closeTo(second / (MIN_WEIGHT + second)),
    ]);
  });

  it("resizes only the named split", () => {
    const layout = createLayout(
      split("s1", "row", [group("g1", ["a"]), split("s2", "column", [group("g2", ["b"]), group("g3", ["c"])])]),
      views("a", "b", "c"),
    );
    const next = resizeSplit(layout, "s2", [1, 4]);
    expect(asSplit(next.root).weights).toEqual([0.5, 0.5]);
    expect(asSplit(asSplit(next.root).children[1]).weights).toEqual([0.2, 0.8]);
  });

  it("ignores a wrong weight count, a group id and an unknown id", () => {
    const layout = twoGroups();
    expect(resizeSplit(layout, "s1", [1, 1, 1])).toBe(layout);
    expect(resizeSplit(layout, "g1", [1])).toBe(layout);
    expect(resizeSplit(layout, "nope", [1, 1])).toBe(layout);
  });
});

describe("toggleMaximize", () => {
  it("maximizes a group and restores it", () => {
    const maximized = toggleMaximize(twoGroups(), "g2");
    expect(maximized.maximized).toBe("g2");
    expect(toggleMaximize(maximized, "g2").maximized).toBeNull();
    expect(toggleMaximize(maximized, "g1").maximized).toBe("g1");
  });

  it("ignores ids that are not groups", () => {
    const layout = twoGroups();
    expect(toggleMaximize(layout, "s1")).toBe(layout);
    expect(toggleMaximize(layout, "nope")).toBe(layout);
  });
});

describe("parseLayout", () => {
  function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      schema: 1,
      root: {
        kind: "split",
        id: "s1",
        direction: "row",
        weights: [0.5, 0.5],
        children: [
          { kind: "group", id: "g1", views: ["a", "b"], active: "b" },
          { kind: "group", id: "g2", views: ["c"], active: "c" },
        ],
      },
      views: { a: { type: "note", params: { id: "a" } }, b: { type: "note" }, c: { type: "home", params: { list: [1, "x", true, null, { deep: [] }] } } },
      maximized: null,
      ...overrides,
    };
  }

  it("round-trips a saved layout", () => {
    const layout = activate(toggleMaximize(twoGroups(), "g2"), "b");
    expect(parseLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout);
  });

  it("reads a valid layout and keeps params", () => {
    const layout = parseLayout(raw());
    expect(layout?.views).toEqual({
      a: { type: "note", params: { id: "a" } },
      b: { type: "note" },
      c: { type: "home", params: { list: [1, "x", true, null, { deep: [] }] } },
    });
    expect(layout?.views.b).not.toHaveProperty("params");
    expect(groupOfView(layout as WorkspaceLayout, "b")?.active).toBe("b");
  });

  it("normalizes what it reads", () => {
    const layout = parseLayout(
      raw({
        root: {
          kind: "split",
          id: "s1",
          direction: "column",
          weights: ["x", 3],
          children: [
            { kind: "group", id: "g1", views: ["a", "zzz"], active: 5 },
            { kind: "group", id: "g2", views: [] },
          ],
        },
        maximized: "g2",
      }),
    );
    expect(layout).toEqual({
      schema: 1,
      root: { kind: "group", id: "g1", views: ["a"], active: "a" },
      views: { a: { type: "note", params: { id: "a" } } },
      maximized: null,
    });
  });

  it("keeps a maximized group and ignores a maximized value that is not a string", () => {
    expect(parseLayout(raw({ maximized: "g1" }))?.maximized).toBe("g1");
    expect(parseLayout(raw({ maximized: 4 }))?.maximized).toBeNull();
  });

  it("reads a split with no children as an empty root group", () => {
    expect(parseLayout(raw({ root: { kind: "split", id: "s9", direction: "row", children: [], weights: [] } }))?.root).toEqual({
      kind: "group",
      id: "s9",
      views: [],
      active: null,
    });
  });

  it.each([
    ["null", null],
    ["a string", "layout"],
    ["a number", 3],
    ["undefined", undefined],
  ])("rejects %s", (_label, value) => {
    expect(parseLayout(value)).toBeNull();
  });

  it.each([
    ["another schema", { schema: 2 }],
    ["missing views", { views: undefined }],
    ["null views", { views: null }],
    ["string views", { views: "a" }],
    ["a missing root", { root: undefined }],
    ["a root that is not an object", { root: "g1" }],
    ["an empty id", { root: { kind: "group", id: "", views: [] } }],
    ["a numeric id", { root: { kind: "group", id: 1, views: [] } }],
    ["group views that are not a list", { root: { kind: "group", id: "g1", views: "a" } }],
    ["a group view that is not a string", { root: { kind: "group", id: "g1", views: ["a", 2] } }],
    ["an unknown kind", { root: { kind: "panel", id: "g1", views: [] } }],
    ["a split with a bad direction", { root: { kind: "split", id: "s1", direction: "diagonal", children: [], weights: [] } }],
    ["split children that are not a list", { root: { kind: "split", id: "s1", direction: "row", children: {}, weights: [] } }],
    ["split weights that are not a list", { root: { kind: "split", id: "s1", direction: "row", children: [], weights: 1 } }],
    [
      "an invalid child",
      { root: { kind: "split", id: "s1", direction: "row", children: [{ kind: "group", id: "g1", views: [] }, null], weights: [1, 1] } },
    ],
    [
      "duplicate group ids",
      {
        root: {
          kind: "split",
          id: "s1",
          direction: "row",
          children: [
            { kind: "group", id: "g1", views: ["a"] },
            { kind: "group", id: "g1", views: ["b"] },
          ],
          weights: [1, 1],
        },
      },
    ],
    ["a group sharing the split's id", { root: { kind: "split", id: "s1", direction: "row", children: [{ kind: "group", id: "s1", views: [] }], weights: [1] } }],
    ["a view that is null", { views: { a: null } }],
    ["a view that is a string", { views: { a: "note" } }],
    ["a view without a type", { views: { a: { params: {} } } }],
    ["params that are null", { views: { a: { type: "note", params: null } } }],
    ["params that are a list", { views: { a: { type: "note", params: [] } } }],
    ["params that are a string", { views: { a: { type: "note", params: "x" } } }],
    ["a NaN param", { views: { a: { type: "note", params: { n: Number.NaN } } } }],
    ["an infinite param", { views: { a: { type: "note", params: { n: [Infinity] } } } }],
    ["an undefined param", { views: { a: { type: "note", params: { n: undefined } } } }],
    ["a function param", { views: { a: { type: "note", params: { n: () => 1 } } } }],
    ["a bigint param", { views: { a: { type: "note", params: { n: BigInt(1) } } } }],
    ["params nested too deep", { views: { a: { type: "note", params: nested(9) } } }],
  ])("rejects %s", (_label, overrides) => {
    expect(parseLayout(raw(overrides))).toBeNull();
  });

  it("accepts params nested up to the limit", () => {
    expect(parseLayout(raw({ views: { a: { type: "note", params: nested(8) } } }))?.views.a.params).toEqual(nested(8));
  });

  it("accepts a tree 32 levels deep and rejects one deeper", () => {
    expect(parseLayout(raw({ root: chain(32) }))?.root).toEqual({ kind: "group", id: "g1", views: ["a"], active: "a" });
    expect(parseLayout(raw({ root: chain(33) }))).toBeNull();
  });
});

describe("evenPair", () => {
  const three = () =>
    createLayout(split("s1", "row", [group("g1", ["a"]), group("g2", ["b"]), group("g3", ["c"])], [0.3, 0.3, 0.4]), views("a", "b", "c"));

  it("splits a pair's space evenly and leaves the rest alone", () => {
    const next = evenPair(three(), "s1", 1);
    const node = findNode(next.root, "s1");
    expect(node?.kind === "split" ? node.weights : null).toEqual([expect.closeTo(0.3), expect.closeTo(0.35), expect.closeTo(0.35)]);
  });

  it("returns the same layout for an even pair, an unknown split, a group id or an index out of range", () => {
    const even = createLayout(split("s1", "row", [group("g1", ["a"]), group("g2", ["b"])]), views("a", "b"));
    expect(evenPair(even, "s1", 0)).toBe(even);
    const layout = three();
    expect(evenPair(layout, "missing", 0)).toBe(layout);
    expect(evenPair(layout, "g1", 0)).toBe(layout);
    expect(evenPair(layout, "s1", -1)).toBe(layout);
    expect(evenPair(layout, "s1", 2)).toBe(layout);
  });
});

describe("sameLayout", () => {
  it("compares layouts by value", () => {
    const layout = createLayout(group("g1", ["a"]), views("a"));
    expect(sameLayout(layout, layout)).toBe(true);
    expect(sameLayout(layout, JSON.parse(JSON.stringify(layout)))).toBe(true);
    expect(sameLayout(layout, activate(createLayout(group("g1", ["a", "b"]), views("a", "b")), "b"))).toBe(false);
  });
});

describe("stage", () => {
  it("keeps the stage group when its last view closes", () => {
    const layout = createLayout(split("s1", "row", [group("g1", ["a"]), group("g2", ["b"])]), views("a", "b"), "g2");
    const next = closeView(layout, "b");
    expect(next.stage).toBe("g2");
    expect(findNode(next.root, "g2")).toMatchObject({ kind: "group", views: [], active: null });
    expect(groupsOf(next.root)).toHaveLength(2);
  });

  it("drops a stage that names no group", () => {
    const layout = createLayout(split("s1", "row", [group("g1", ["a"]), group("g2", ["b"])]), views("a", "b"), "s1");
    expect("stage" in layout).toBe(false);
    expect("stage" in createLayout(group("g1", ["a"]), views("a"), "missing")).toBe(false);
  });

  it("reads the stage from a saved layout and ignores one that isn't a string", () => {
    const saved = createLayout(split("s1", "row", [group("g1", ["a"]), group("g2", [])]), views("a"), "g2");
    expect(parseLayout(JSON.parse(JSON.stringify(saved)))?.stage).toBe("g2");
    const broken = { ...JSON.parse(JSON.stringify(saved)), stage: 7 };
    expect(parseLayout(broken)?.stage).toBeUndefined();
  });
});

describe("revealing views hidden by a maximized group", () => {
  it("restores the layout when an existing view in another group is opened", () => {
    const layout = toggleMaximize(
      createLayout(split("s1", "row", [group("g1", ["a"]), group("g2", ["b"])]), views("a", "b")),
      "g1",
    );
    expect(openView(layout, "b", { type: "note" }, { groupId: "g1", zone: "center" }).maximized).toBeNull();
    expect(openView(layout, "a", { type: "note" }, { groupId: "g2", zone: "center" }).maximized).toBe("g1");
  });

  it("keeps the maximized group when a view joins it", () => {
    const layout = toggleMaximize(
      createLayout(split("s1", "row", [group("g1", ["a"]), group("g2", ["b"])]), views("a", "b")),
      "g1",
    );
    const next = moveView(layout, "b", { groupId: "g1", zone: "center" });
    expect(next.maximized).toBe("g1");
    expect(groupOfView(next, "b")?.id).toBe("g1");
  });
});
