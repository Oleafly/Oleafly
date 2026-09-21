// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { getWysiwygMode, setWysiwygMode, getMarkdownSplitSize, setMarkdownSplitSize, getMarkdownSplitLayout, setMarkdownSplitLayout } from "./wysiwyg-mode";

describe("wysiwyg-mode", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to false for a project that has never toggled", () => {
    expect(getWysiwygMode("proj-1")).toBe(false);
  });

  it("persists true/false per project id", () => {
    setWysiwygMode("proj-1", true);
    expect(getWysiwygMode("proj-1")).toBe(true);
    expect(getWysiwygMode("proj-2")).toBe(false);
    setWysiwygMode("proj-1", false);
    expect(getWysiwygMode("proj-1")).toBe(false);
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
