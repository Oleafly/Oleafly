import { Mapping, StepMap } from "@tiptap/pm/transform";
import { describe, expect, it } from "vitest";
import { LocalEdits } from "./local-edits";

function insertion(at: number, length: number): StepMap {
  return new StepMap([at, 0, length]);
}

function deletion(at: number, length: number): StepMap {
  return new StepMap([at, length, 0]);
}

describe("local edits", () => {
  it("starts clean and overlaps nothing", () => {
    const edits = new LocalEdits();
    expect(edits.dirty).toBe(false);
    expect(edits.overlaps(0, 1000)).toBe(false);
  });

  it("records the range a typed insertion covers", () => {
    const edits = new LocalEdits();
    edits.record(new Mapping([insertion(4, 3)]));
    expect(edits.dirty).toBe(true);
    expect(edits.overlaps(0, 3)).toBe(false);
    expect(edits.overlaps(0, 4)).toBe(true);
    expect(edits.overlaps(5, 6)).toBe(true);
    expect(edits.overlaps(7, 9)).toBe(true);
    expect(edits.overlaps(8, 9)).toBe(false);
  });

  it("records a deletion as the point where the text was removed", () => {
    const edits = new LocalEdits();
    edits.record(new Mapping([deletion(2, 5)]));
    expect(edits.overlaps(2, 2)).toBe(true);
    expect(edits.overlaps(0, 1)).toBe(false);
    expect(edits.overlaps(3, 8)).toBe(false);
  });

  it("moves earlier edits along when later text shifts them", () => {
    const edits = new LocalEdits();
    edits.record(new Mapping([insertion(4, 3)]));
    edits.record(new Mapping([insertion(0, 2)]));
    expect(edits.overlaps(0, 2)).toBe(true);
    expect(edits.overlaps(3, 5)).toBe(false);
    expect(edits.overlaps(6, 6)).toBe(true);
    expect(edits.overlaps(9, 9)).toBe(true);
    expect(edits.overlaps(10, 12)).toBe(false);
  });

  it("maps every step of one transaction through the steps after it", () => {
    const single = new LocalEdits();
    single.record(new Mapping([insertion(4, 3), insertion(0, 2)]));
    expect(single.overlaps(0, 2)).toBe(true);
    expect(single.overlaps(3, 5)).toBe(false);
    expect(single.overlaps(6, 9)).toBe(true);
    expect(single.overlaps(10, 12)).toBe(false);
  });

  it("grows an edit when more text is typed at either edge", () => {
    const edits = new LocalEdits();
    edits.record(new Mapping([insertion(4, 3)]));
    edits.record(new Mapping([insertion(7, 2)]));
    edits.record(new Mapping([insertion(4, 1)]));
    expect(edits.overlaps(3, 3)).toBe(false);
    expect(edits.overlaps(4, 4)).toBe(true);
    expect(edits.overlaps(10, 10)).toBe(true);
    expect(edits.overlaps(11, 12)).toBe(false);
  });

  it("ignores a mapping without changes", () => {
    const edits = new LocalEdits();
    edits.record(new Mapping([StepMap.empty]));
    expect(edits.dirty).toBe(false);
  });

  it("forgets every edit once cleared", () => {
    const edits = new LocalEdits();
    edits.record(new Mapping([insertion(1, 4)]));
    edits.clear();
    expect(edits.dirty).toBe(false);
    expect(edits.overlaps(0, 10)).toBe(false);
  });
});
