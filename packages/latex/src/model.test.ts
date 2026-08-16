import { describe, expect, it } from "vitest";
import { emptyModel, newId } from "./model";

describe("emptyModel", () => {
  it("starts with no nodes or edges", () => {
    expect(emptyModel()).toEqual({ version: 1, nodes: [], edges: [] });
  });

  it("hands back a fresh object each time, so callers cannot alias one model", () => {
    const first = emptyModel();
    first.nodes.push({} as never);
    expect(emptyModel().nodes).toEqual([]);
  });
});

describe("newId", () => {
  it("uses the given prefix and defaults to n", () => {
    expect(newId()).toMatch(/^n\d+_[0-9a-f-]{5}$/);
    expect(newId("edge")).toMatch(/^edge\d+_[0-9a-f-]{5}$/);
  });

  it("never repeats an id, even for the same prefix", () => {
    const ids = Array.from({ length: 200 }, () => newId("n"));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the counter monotonic so ids sort in creation order", () => {
    const a = Number(newId("x").slice(1).split("_")[0]);
    const b = Number(newId("x").slice(1).split("_")[0]);
    expect(b).toBe(a + 1);
  });
});
