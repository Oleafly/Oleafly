import { describe, expect, it } from "vitest";
import { carriesTreePath, TREE_DRAG_TYPE, treeDragPath } from "./tree-drag";

function transfer(data: Record<string, string>) {
  return { types: Object.keys(data), getData: (type: string) => data[type] ?? "" };
}

describe("tree drags", () => {
  it("normalizes a Windows tree path and keeps spaces", () => {
    expect(treeDragPath(transfer({ [TREE_DRAG_TYPE]: "figures\\plot one.png" }))).toBe(
      "figures/plot one.png",
    );
    expect(treeDragPath(transfer({ [TREE_DRAG_TYPE]: "chapters/" }))).toBe("chapters");
  });

  it("reads no tree path from a drag that is not from the tree", () => {
    expect(carriesTreePath(transfer({ "text/plain": "x" }))).toBe(false);
    expect(treeDragPath(transfer({ "text/plain": "x" }))).toBeNull();
    expect(treeDragPath(transfer({ [TREE_DRAG_TYPE]: "" }))).toBeNull();
    expect(treeDragPath(null)).toBeNull();
  });
});
