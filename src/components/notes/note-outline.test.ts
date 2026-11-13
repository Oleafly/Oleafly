// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeHeadingIndex,
  domOutline,
  headingTops,
  markdownOutline,
  noteEditorRoot,
  outlineRows,
  scrollParent,
  type OutlineHeading,
} from "./note-outline";

function heading(index: number, level: number, text = `H${index}`): OutlineHeading {
  return { index, level, text, slug: text.toLowerCase() };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("note outline", () => {
  it("reads headings from Markdown outside code and front matter", () => {
    expect(markdownOutline("---\ntitle: x\n---\n# Intro\n```\n# code\n```\n## *Methods*\n## Intro\n#\n")).toEqual([
      { index: 0, level: 1, text: "Intro", slug: "intro" },
      { index: 1, level: 2, text: "Methods", slug: "methods" },
      { index: 2, level: 2, text: "Intro", slug: "intro-1" },
    ]);
  });

  it("reads top level headings from the editor", () => {
    document.body.innerHTML =
      '<div data-note-view="n1"><div class="ProseMirror"><h1>Intro</h1><p>x</p><h2>  Two   words </h2><blockquote><h2>Inner</h2></blockquote><h3></h3><h2>Intro</h2></div></div>';
    const root = noteEditorRoot("n1");
    expect(root).not.toBeNull();
    const { headings, elements } = domOutline(root as HTMLElement);
    expect(headings).toEqual([
      { index: 0, level: 1, text: "Intro", slug: "intro" },
      { index: 1, level: 2, text: "Two words", slug: "two-words" },
      { index: 2, level: 2, text: "Intro", slug: "intro-1" },
    ]);
    expect(elements).toHaveLength(3);
    expect(noteEditorRoot("n2")).toBeNull();
    document.body.innerHTML = '<div data-note-view="n3"></div>';
    expect(noteEditorRoot("n3")).toBeNull();
  });

  it("indents, folds and limits levels", () => {
    const headings = [heading(0, 1), heading(1, 2), heading(2, 3), heading(3, 2), heading(4, 1), heading(5, 3)];
    expect(outlineRows(headings, new Set(), 6).map((row) => [row.heading.index, row.depth, row.hasChildren])).toEqual([
      [0, 0, true],
      [1, 1, true],
      [2, 2, false],
      [3, 1, false],
      [4, 0, true],
      [5, 1, false],
    ]);
    const folded = outlineRows(headings, new Set([1, 2, 4]), 6);
    expect(folded.map((row) => [row.heading.index, row.collapsed])).toEqual([
      [0, false],
      [1, true],
      [3, false],
      [4, true],
    ]);
    expect(outlineRows(headings, new Set(), 1).map((row) => row.heading.index)).toEqual([0, 4]);
    expect(outlineRows(headings, new Set([0]), 1).map((row) => row.collapsed)).toEqual([false, false]);
  });

  it("finds the heading at the top of the view", () => {
    expect(activeHeadingIndex([])).toBe(-1);
    expect(activeHeadingIndex([100, 300])).toBe(-1);
    expect(activeHeadingIndex([-40, 10, 300])).toBe(1);
    expect(activeHeadingIndex([-40, -10], 0)).toBe(1);
  });

  it("finds the scroll container and measures headings against it", () => {
    document.body.innerHTML =
      '<div id="marked" data-note-width="normal"><h1 id="a">A</h1></div><div id="plain" style="overflow-y: auto"><h1 id="b">B</h1></div><h1 id="c">C</h1>';
    const marked = document.getElementById("marked") as HTMLElement;
    expect(scrollParent(document.getElementById("a") as HTMLElement)).toBe(marked);
    expect(scrollParent(document.getElementById("b") as HTMLElement)).toBe(document.getElementById("plain"));
    expect(scrollParent(document.getElementById("c") as HTMLElement)).toBeNull();
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return { top: this === marked ? 50 : 80 } as DOMRect;
    });
    expect(headingTops([document.getElementById("a") as HTMLElement], marked)).toEqual([30]);
  });
});
