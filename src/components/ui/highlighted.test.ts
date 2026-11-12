import { describe, expect, it } from "vitest";
import { highlightParts } from "./highlighted";

describe("highlightParts", () => {
  it("cuts text into highlighted and plain parts", () => {
    expect(highlightParts("masking ablation", [[8, 16], [0, 7]])).toEqual([
      { text: "masking", start: 0, match: true },
      { text: " ", start: 7, match: false },
      { text: "ablation", start: 8, match: true },
    ]);
    expect(highlightParts("abcdef", [[1, 4], [2, 5], [5, 5], [-3, 0], [4, 99]])).toEqual([
      { text: "a", start: 0, match: false },
      { text: "bcd", start: 1, match: true },
      { text: "e", start: 4, match: true },
      { text: "f", start: 5, match: true },
    ]);
    expect(highlightParts("", [])).toEqual([{ text: "", start: 0, match: false }]);
    expect(highlightParts("abc", [[0, 3]])).toEqual([{ text: "abc", start: 0, match: true }]);
  });
});
