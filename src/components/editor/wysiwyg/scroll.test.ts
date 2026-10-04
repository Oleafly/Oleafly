// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@tiptap/pm/view";
import { scrollVisualSelectionLocally } from "./scroll";

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
});

describe("scrollVisualSelectionLocally", () => {
  it("moves only the Visual editor scroller for an offscreen selection", () => {
    const scroller = document.createElement("div");
    scroller.className = "wysiwyg-content";
    const editorDom = document.createElement("div");
    editorDom.className = "ProseMirror";
    scroller.append(editorDom);
    document.body.append(scroller);
    scroller.scrollTop = 100;
    document.documentElement.scrollTop = 47;
    document.body.scrollTop = 31;

    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 600,
      left: 50,
      right: 850,
      width: 800,
      height: 500,
      x: 50,
      y: 100,
      toJSON: () => ({}),
    });
    const coordsAtPos = vi.fn(() => ({
      top: 680,
      bottom: 700,
      left: 120,
      right: 121,
    }));
    const view = {
      dom: editorDom,
      state: { selection: { head: 42 } },
      coordsAtPos,
    } as unknown as EditorView;

    expect(scrollVisualSelectionLocally(view)).toBe(true);
    expect(coordsAtPos).toHaveBeenCalledWith(42, 1);
    expect(scroller.scrollTop).toBe(248);
    expect(document.documentElement.scrollTop).toBe(47);
    expect(document.body.scrollTop).toBe(31);
  });

  it("suppresses ProseMirror's document fallback even before its scroller mounts", () => {
    const editorDom = document.createElement("div");
    document.body.append(editorDom);
    const coordsAtPos = vi.fn();
    const view = {
      dom: editorDom,
      state: { selection: { head: 0 } },
      coordsAtPos,
    } as unknown as EditorView;

    expect(scrollVisualSelectionLocally(view)).toBe(true);
    expect(coordsAtPos).not.toHaveBeenCalled();
  });
});

describe("scrollVisualSelectionLocally edges", () => {
  function setup(rect: { top: number; bottom: number; left: number; right: number } | Error) {
    const scroller = document.createElement("div");
    scroller.className = "wysiwyg-content";
    const editorDom = document.createElement("div");
    scroller.append(editorDom);
    document.body.append(scroller);
    scroller.scrollTop = 300;
    scroller.scrollLeft = 200;
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 600,
      left: 50,
      right: 850,
    } as DOMRect);
    const view = {
      dom: editorDom,
      state: { selection: { head: 7 } },
      coordsAtPos: vi.fn(() => {
        if (rect instanceof Error) throw rect;
        return rect;
      }),
    } as unknown as EditorView;
    return { scroller, view };
  }

  it("scrolls up and left for a selection above and before the margins", () => {
    const { scroller, view } = setup({ top: 110, bottom: 130, left: 60, right: 61 });
    scrollVisualSelectionLocally(view);
    expect(scroller.scrollTop).toBe(300 + (110 - 100 - 48));
    expect(scroller.scrollLeft).toBe(200 + (60 - 50 - 48));
  });

  it("scrolls right for a selection past the right margin", () => {
    const { scroller, view } = setup({ top: 300, bottom: 320, left: 840, right: 845 });
    scrollVisualSelectionLocally(view);
    expect(scroller.scrollTop).toBe(300);
    expect(scroller.scrollLeft).toBe(200 + (845 - 850 + 48));
  });

  it("leaves a comfortably visible selection alone", () => {
    const { scroller, view } = setup({ top: 300, bottom: 320, left: 400, right: 401 });
    expect(scrollVisualSelectionLocally(view)).toBe(true);
    expect(scroller.scrollTop).toBe(300);
    expect(scroller.scrollLeft).toBe(200);
  });

  it("gives up when the selection has no coordinates yet", () => {
    const { scroller, view } = setup(new Error("not rendered"));
    expect(scrollVisualSelectionLocally(view)).toBe(true);
    expect(scroller.scrollTop).toBe(300);
  });
});
