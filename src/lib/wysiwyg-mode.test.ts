// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  getKindModes,
  getMarkdownSplitLayout,
  getMarkdownSplitSize,
  saveKindModes,
  setMarkdownSplitLayout,
  setMarkdownSplitSize,
  sourcePreviewKind,
  viewKind,
} from "./wysiwyg-mode";

describe("wysiwyg-mode", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("sorts files into the kinds that keep a mode of their own", () => {
    expect(viewKind("slides/talk/index.tsx")).toBe("deck");
    expect(viewKind("src/index.tsx")).toBe("source");
    expect(viewKind("site/Page.HTM")).toBe("html");
    expect(viewKind("refs.bib")).toBe("bib");
    expect(viewKind("data/runs.tsv")).toBe("sheet");
    expect(viewKind("README.markdown")).toBe("markdown");
    expect(viewKind("report.qmd")).toBe("source");
    expect(viewKind("main.typ")).toBe("source");
    expect(sourcePreviewKind(null)).toBeNull();
    expect(sourcePreviewKind("main.tex")).toBeNull();
  });

  it("keeps the mode of each kind per project", () => {
    expect(getKindModes("proj-1")).toEqual({});
    saveKindModes("proj-1", { source: "visual", sheet: "code" });
    expect(getKindModes("proj-1")).toEqual({ source: "visual", sheet: "code" });
    expect(getKindModes("proj-2")).toEqual({});
  });

  it("restores split sizes per project and rejects invalid stored sizes", () => {
    expect(getMarkdownSplitSize("first")).toBe(50);
    setMarkdownSplitSize("first", 62);
    expect(getMarkdownSplitSize("first")).toBe(62);
    expect(getMarkdownSplitSize("second")).toBe(50);
    setMarkdownSplitSize("first", Number.NaN);
    expect(getMarkdownSplitSize("first")).toBe(62);
    localStorage.setItem("oleafly.markdown-split-size.first", "101");
    expect(getMarkdownSplitSize("first")).toBe(50);
  });

  it("restores the arrangement and falls back to Split for unknown stored values", () => {
    expect(getMarkdownSplitLayout("first")).toBe("split");
    setMarkdownSplitLayout("first", "stacked");
    expect(getMarkdownSplitLayout("first")).toBe("stacked");
    expect(getMarkdownSplitLayout("second")).toBe("split");
    localStorage.setItem("oleafly.markdown-split-layout.first", "invalid");
    expect(getMarkdownSplitLayout("first")).toBe("split");
  });
});
