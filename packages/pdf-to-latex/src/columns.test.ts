import { describe, expect, it } from "vitest";
import { detectColumns, orderByColumns } from "./columns";
import type { TextItem } from "./types";

const it_ = (str: string, x: number, y: number): TextItem => ({
  str,
  x,
  y,
  width: 80,
  height: 10,
  fontName: "F1",
  fontSize: 10,
});

const twoCol = [it_("L1", 40, 700), it_("L2", 40, 688), it_("R1", 320, 700), it_("R2", 320, 688)];

describe("detectColumns", () => {
  it("finds two columns with a clear gutter", () => {
    const d = detectColumns(twoCol, 600);
    expect(d.count).toBe(2);
    expect(d.splitX).toBeGreaterThan(120);
    expect(d.splitX).toBeLessThan(320);
  });

  it("reports one column for narrow-spread text", () => {
    expect(detectColumns([it_("a", 100, 700), it_("b", 110, 688), it_("c", 105, 676), it_("d", 112, 664)], 600).count).toBe(1);
  });

  it("reports one column when too few items", () => {
    expect(detectColumns([it_("a", 40, 700), it_("b", 320, 700)], 600).count).toBe(1);
  });
});

describe("orderByColumns", () => {
  it("emits the whole left column before the right column", () => {
    const ordered = orderByColumns(twoCol, 600).map((i) => i.str);
    expect(ordered).toEqual(["L1", "L2", "R1", "R2"]);
  });

  it("forced 1 column keeps original order", () => {
    expect(orderByColumns(twoCol, 600, 1).map((i) => i.str)).toEqual(["L1", "L2", "R1", "R2"]);
  });

  it("forced 2 columns splits at mid page", () => {
    const ordered = orderByColumns(twoCol, 600, 2).map((i) => i.str);
    expect(ordered).toEqual(["L1", "L2", "R1", "R2"]);
  });
});
