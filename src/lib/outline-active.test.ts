import { describe, expect, it } from "vitest";
import type { IncludeStep, OutlineItem } from "@/lib/index/outline";
import { activeOutlineIndex } from "./outline-active";

function section(file: string, from: number, title: string): OutlineItem {
  return { level: 2, title, line: 1, file, kind: "section", from, to: from + 10 };
}

function included(file: string): OutlineItem {
  return { level: 2, title: file, line: 1, file, kind: "file", from: 0, to: 0 };
}

const viaMain = (from: number): readonly IncludeStep[] => [{ file: "main.tex", from }];

describe("activeOutlineIndex", () => {
  const items = [
    section("main.tex", 100, "Introduction"),
    section("ch1.tex", 0, "Background"),
    section("ch1.tex", 400, "Prior work"),
    section("main.tex", 900, "Conclusion"),
  ];
  const trails = [[], viaMain(500), viaMain(500), []];

  it("picks the last heading at or before the anchor", () => {
    expect(activeOutlineIndex(items, { path: "main.tex", pos: 950 }, trails)).toBe(3);
  });

  it("stays on a heading while the anchor is inside its body", () => {
    expect(activeOutlineIndex(items, { path: "main.tex", pos: 101 }, trails)).toBe(0);
  });

  it("activates a heading exactly at its start offset", () => {
    expect(activeOutlineIndex(items, { path: "ch1.tex", pos: 400 }, trails)).toBe(2);
  });

  it("reads a parent file past an include as the included file's last heading", () => {
    expect(activeOutlineIndex(items, { path: "main.tex", pos: 600 }, trails)).toBe(2);
    expect(activeOutlineIndex(items, { path: "main.tex", pos: 499 }, trails)).toBe(0);
  });

  it("reads an included file above its first heading as the section that includes it", () => {
    const late = [section("main.tex", 100, "Introduction"), section("ch1.tex", 50, "Background")];
    expect(activeOutlineIndex(late, { path: "ch1.tex", pos: 10 }, [[], viaMain(300)])).toBe(0);
  });

  it("reads an included file without headings as the section that includes it", () => {
    const outline = [section("main.tex", 100, "Introduction"), included("table.tex"), section("main.tex", 900, "End")];
    expect(activeOutlineIndex(outline, { path: "table.tex", pos: 40 }, [[], viaMain(300), []])).toBe(0);
  });

  it("selects nothing above the file's first heading", () => {
    expect(activeOutlineIndex(items, { path: "main.tex", pos: 20 }, trails)).toBe(-1);
  });

  it("selects nothing for a file the outline does not list", () => {
    expect(activeOutlineIndex(items, { path: "appendix.tex", pos: 5000 }, trails)).toBe(-1);
  });

  it("selects nothing without an anchor", () => {
    expect(activeOutlineIndex(items, null, trails)).toBe(-1);
  });

  it("selects nothing in an empty outline", () => {
    expect(activeOutlineIndex([], { path: "main.tex", pos: 10 }, [])).toBe(-1);
  });
});
