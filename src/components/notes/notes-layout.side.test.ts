import { createLayout, group, groupOfView, groupsOf, split, type ViewState, type WorkspaceLayout } from "@oleafly/workspace";
import { describe, expect, it } from "vitest";
import {
  ARTIFACTS_VIEW,
  cleanNotesLayout,
  GRAPH_VIEW,
  HOME_VIEW,
  INFO_VIEW,
  isSideView,
  LOCAL_GRAPH_VIEW,
  noteView,
  noteViewId,
  openGraphIn,
  openNoteFrom,
  OUTLINE_VIEW,
  sideView,
  stageGroup,
  toggleSideView,
} from "./notes-layout";

const home: ViewState = { type: "home" };

function layoutOf(root: WorkspaceLayout["root"], views: Record<string, ViewState>): WorkspaceLayout {
  return createLayout(root, views);
}

function views(layout: WorkspaceLayout): string[][] {
  return groupsOf(layout.root).map((candidate) => candidate.views);
}

describe("graph and outline views", () => {
  it("knows the side views and how to make them", () => {
    expect([ARTIFACTS_VIEW, LOCAL_GRAPH_VIEW, OUTLINE_VIEW, INFO_VIEW].every(isSideView)).toBe(true);
    expect([GRAPH_VIEW, HOME_VIEW, "note:n1", null, undefined].some(isSideView)).toBe(false);
    expect(sideView(ARTIFACTS_VIEW)).toEqual({ type: "artifacts" });
    expect(sideView(LOCAL_GRAPH_VIEW)).toEqual({ type: "graph", params: { local: true } });
    expect(sideView(OUTLINE_VIEW)).toEqual({ type: "outline" });
    expect(sideView(INFO_VIEW)).toEqual({ type: "info" });
    expect(sideView(GRAPH_VIEW)).toBeNull();
  });

  it("keeps graph and outline views when cleaning a saved layout", () => {
    const layout = layoutOf(group("g1", [HOME_VIEW, GRAPH_VIEW, LOCAL_GRAPH_VIEW, OUTLINE_VIEW, INFO_VIEW, "bad-graph", "bad-local"]), {
      [HOME_VIEW]: home,
      [GRAPH_VIEW]: { type: "graph" },
      [LOCAL_GRAPH_VIEW]: { type: "graph", params: { local: true } },
      [OUTLINE_VIEW]: { type: "outline" },
      [INFO_VIEW]: { type: "info" },
      "bad-graph": { type: "graph" },
      "bad-local": { type: "outline" },
    });
    expect(Object.keys(cleanNotesLayout(layout).views).sort()).toEqual([GRAPH_VIEW, HOME_VIEW, INFO_VIEW, LOCAL_GRAPH_VIEW, OUTLINE_VIEW].sort());
    const swapped = layoutOf(group("g1", [GRAPH_VIEW, LOCAL_GRAPH_VIEW, OUTLINE_VIEW, INFO_VIEW]), {
      [GRAPH_VIEW]: { type: "graph", params: { local: true } },
      [LOCAL_GRAPH_VIEW]: { type: "graph" },
      [OUTLINE_VIEW]: { type: "graph" },
      [INFO_VIEW]: { type: "outline" },
    });
    expect(Object.keys(cleanNotesLayout(swapped).views)).toEqual([HOME_VIEW]);
  });

  it("opens a side view beside the note, stacks the next one with it and closes it again", () => {
    const start = layoutOf(group("g1", [HOME_VIEW, "note:n1"], "note:n1"), { [HOME_VIEW]: home, "note:n1": noteView("n1") });
    const outline = toggleSideView(start, OUTLINE_VIEW, "note:n1");
    expect(views(outline)).toEqual([[HOME_VIEW, "note:n1"], [OUTLINE_VIEW]]);
    const both = toggleSideView(outline, LOCAL_GRAPH_VIEW, "note:n1");
    expect(views(both)).toEqual([[HOME_VIEW, "note:n1"], [OUTLINE_VIEW, LOCAL_GRAPH_VIEW]]);
    expect(both.views[LOCAL_GRAPH_VIEW]).toEqual({ type: "graph", params: { local: true } });
    expect(views(toggleSideView(both, INFO_VIEW, "note:n1"))).toEqual([[HOME_VIEW, "note:n1"], [OUTLINE_VIEW, LOCAL_GRAPH_VIEW, INFO_VIEW]]);
    expect(views(toggleSideView(start, INFO_VIEW, "note:n1"))).toEqual([[HOME_VIEW, "note:n1"], [INFO_VIEW]]);
    const closed = toggleSideView(both, OUTLINE_VIEW, "note:n1");
    expect(views(closed)).toEqual([[HOME_VIEW, "note:n1"], [LOCAL_GRAPH_VIEW]]);
    expect(toggleSideView(start, GRAPH_VIEW, null)).toBe(start);
  });

  it("puts the stage next to notes when a side panel has focus", () => {
    const layout = layoutOf(split("s", "row", [group("g1", [OUTLINE_VIEW]), group("g2", ["note:n1"])]), {
      [OUTLINE_VIEW]: { type: "outline" },
      "note:n1": noteView("n1"),
    });
    expect(stageGroup({ ...layout, stage: "missing" }, OUTLINE_VIEW).id).toBe("g2");
    const onlySide = layoutOf(split("s", "row", [group("g1", [OUTLINE_VIEW]), group("g2", [GRAPH_VIEW])]), {
      [OUTLINE_VIEW]: { type: "outline" },
      [GRAPH_VIEW]: { type: "graph" },
    });
    expect(stageGroup({ ...onlySide, stage: "missing" }, null).id).toBe("g2");
  });

  it("opens the graph in the stage", () => {
    const start = layoutOf(group("g1", [HOME_VIEW]), { [HOME_VIEW]: home });
    const opened = openGraphIn(start, null);
    expect(views(opened)).toEqual([[HOME_VIEW, GRAPH_VIEW]]);
    expect(groupOfView(opened, GRAPH_VIEW)?.active).toBe(GRAPH_VIEW);
  });

  it("opens a note from the graph in place of the active note, or as a tab", () => {
    const start = layoutOf(split("s", "row", [group("g1", ["note:n1", "note:n2"], "note:n1"), group("g2", [GRAPH_VIEW])]), {
      "note:n1": noteView("n1"),
      "note:n2": noteView("n2"),
      [GRAPH_VIEW]: { type: "graph" },
    });
    const replaced = openNoteFrom(start, "n3", "note:n1");
    expect(views(replaced)).toEqual([["note:n3", "note:n2"], [GRAPH_VIEW]]);
    const existing = openNoteFrom(start, "n2", "note:n1");
    expect(groupOfView(existing, "note:n2")?.active).toBe("note:n2");
    expect(views(existing)).toEqual([["note:n1", "note:n2"], [GRAPH_VIEW]]);
    expect(views(openNoteFrom(start, "n1", "note:n1"))).toEqual([["note:n1", "note:n2"], [GRAPH_VIEW]]);
    const fromGraph = openNoteFrom(start, "n4", GRAPH_VIEW);
    expect(views(fromGraph)).toEqual([["note:n1", "note:n2"], [GRAPH_VIEW, noteViewId("n4")]]);
  });
});
