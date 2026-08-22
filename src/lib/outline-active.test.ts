import { describe, expect, it } from "vitest";
import type { OutlineItem } from "@/lib/index/outline";
import { activeOutlineIndex } from "./outline-active";

function section(file: string, from: number, title: string): OutlineItem {
  return { level: 2, title, line: 1, file, kind: "section", from, to: from + 10 };
}

describe("activeOutlineIndex", () => {
  const items = [
    section("main.tex", 100, "Introduction"),
    section("ch1.tex", 0, "Background"),
    section("ch1.tex", 400, "Prior work"),
    section("main.tex", 900, "Conclusion"),
  ];

  it("picks the last heading at or before the anchor", () => {
    expect(activeOutlineIndex(items, { path: "main.tex", pos: 950 })).toBe(3);
  });

  it("stays on a heading while the anchor is inside its body", () => {
    expect(activeOutlineIndex(items, { path: "main.tex", pos: 101 })).toBe(0);
  });

  it("activates a heading exactly at its start offset", () => {
    expect(activeOutlineIndex(items, { path: "ch1.tex", pos: 400 })).toBe(2);
  });

  it("ignores headings that belong to other files in the outline", () => {
    expect(activeOutlineIndex(items, { path: "ch1.tex", pos: 399 })).toBe(1);
  });

  it("selects nothing above the file's first heading", () => {
    expect(activeOutlineIndex(items, { path: "main.tex", pos: 20 })).toBe(-1);
  });

  it("selects nothing for a file the outline does not list", () => {
    expect(activeOutlineIndex(items, { path: "appendix.tex", pos: 5000 })).toBe(-1);
  });

  it("selects nothing without an anchor", () => {
    expect(activeOutlineIndex(items, null)).toBe(-1);
  });

  it("selects nothing in an empty outline", () => {
    expect(activeOutlineIndex([], { path: "main.tex", pos: 10 })).toBe(-1);
  });
});
