// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadNamespace } from "@/i18n";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { activeChangeBox, FloatingReview, REVIEW_GAP_PX, reviewPlacement, type Box } from "./FloatingReview";
import "./tests/setup";

const suggestions = vi.hoisted(() => ({
  acceptActive: vi.fn(),
  acceptAll: vi.fn(),
  moveReview: vi.fn(),
  rejectActive: vi.fn(),
  rejectAll: vi.fn(),
}));

vi.mock("./note-suggestions", () => suggestions);

const AREA: Box = { top: 100, bottom: 700, left: 0, right: 800 };
const BAR = { width: 120, height: 36 };

function rect(box: Box): DOMRect {
  return {
    ...box,
    width: box.right - box.left,
    height: box.bottom - box.top,
    x: box.left,
    y: box.top,
    toJSON: () => ({}),
  };
}

function place(element: Element, box: Box) {
  (element as HTMLElement).getBoundingClientRect = () => rect(box);
}

function frame() {
  return act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

beforeAll(async () => {
  await loadNamespace("editor");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("reviewPlacement", () => {
  it("sits just below the change, lined up with its right edge", () => {
    expect(reviewPlacement({ top: 200, bottom: 260, left: 40, right: 640 }, AREA, BAR)).toEqual({
      top: 260 + REVIEW_GAP_PX,
      left: 640 - BAR.width,
    });
  });

  it("stays in view above the composer while a long change runs past the bottom", () => {
    expect(reviewPlacement({ top: 400, bottom: 1600, left: 40, right: 640 }, AREA, BAR)?.top).toBe(
      AREA.bottom - BAR.height - REVIEW_GAP_PX,
    );
  });

  it("sticks under the toolbar when the change has scrolled above the view", () => {
    expect(reviewPlacement({ top: -400, bottom: 20, left: 40, right: 640 }, AREA, BAR)?.top).toBe(AREA.top + REVIEW_GAP_PX);
  });

  it("keeps inside the pane sideways, and waits above the composer when the change can't be measured", () => {
    expect(reviewPlacement({ top: 200, bottom: 220, left: 0, right: 60 }, AREA, BAR)?.left).toBe(REVIEW_GAP_PX);
    expect(reviewPlacement({ top: 200, bottom: 220, left: 700, right: 900 }, AREA, BAR)?.left).toBe(
      AREA.right - BAR.width - REVIEW_GAP_PX,
    );
    expect(reviewPlacement(null, AREA, BAR)).toEqual({
      top: AREA.bottom - BAR.height - REVIEW_GAP_PX,
      left: (AREA.right - BAR.width) / 2,
    });
  });
});

describe("activeChangeBox", () => {
  it("anchors to the paragraph or block that holds the change, joins them, and skips empty ones", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<p>The ratio was <span class="note-diff-delete note-diff-active">0.75</span><span class="note-diff-insert note-diff-active">0.60</span> today.</p>' +
      '<div class="note-diff-block note-diff-active"><p>New paragraph</p></div>' +
      '<span class="note-diff-active"></span><span class="note-diff-insert">other</span>';
    const [paragraph, block, empty, other] = [...root.children];
    place(paragraph, { top: 200, bottom: 260, left: 40, right: 640 });
    for (const part of paragraph.querySelectorAll("span")) place(part, { top: 200, bottom: 220, left: 300, right: 340 });
    place(block, { top: 270, bottom: 330, left: 40, right: 600 });
    place(empty, { top: 0, bottom: 0, left: 0, right: 0 });
    place(other, { top: 900, bottom: 950, left: 0, right: 900 });
    expect(activeChangeBox(root)).toEqual({ top: 200, bottom: 330, left: 40, right: 640 });
  });

  it("uses the change itself when no block holds it, and has nothing without a change", () => {
    const root = document.createElement("div");
    root.innerHTML = '<span class="note-diff-insert note-diff-active">loose</span>';
    place(root.firstElementChild as Element, { top: 10, bottom: 30, left: 5, right: 50 });
    const outer = document.createElement("p");
    outer.append(root);
    expect(activeChangeBox(root)).toEqual({ top: 10, bottom: 30, left: 5, right: 50 });
    expect(activeChangeBox(document.createElement("div"))).toBeNull();
  });
});

describe("FloatingReview", () => {
  function setup(active = true) {
    const scroller = document.createElement("div");
    const toolbar = document.createElement("div");
    toolbar.setAttribute("role", "toolbar");
    const dom = document.createElement("div");
    const change = document.createElement("div");
    change.className = active ? "note-diff-block note-diff-active" : "note-diff-block";
    dom.append(change);
    const dock = document.createElement("div");
    scroller.append(toolbar, dom, dock);
    document.body.append(scroller);
    place(scroller, { top: 0, bottom: 800, left: 0, right: 900 });
    place(toolbar, { top: 0, bottom: 36, left: 0, right: 900 });
    place(dock, { top: 640, bottom: 800, left: 0, right: 900 });
    place(change, { top: 200, bottom: 300, left: 100, right: 700 });
    const listeners = new Set<() => void>();
    const editor = {
      isDestroyed: false,
      view: { dom, focus: vi.fn() },
      on: (_event: string, listener: () => void) => listeners.add(listener),
      off: (_event: string, listener: () => void) => listeners.delete(listener),
    } as unknown as Editor;
    const scrollRef = createRef<HTMLElement>();
    const bottomRef = createRef<HTMLElement>();
    Object.assign(scrollRef, { current: scroller });
    Object.assign(bottomRef, { current: dock });
    const view = render(
      <FloatingReview editor={editor} review={{ count: 2, index: 0, activeId: "change-1" }} scrollRef={scrollRef} bottomRef={bottomRef} />,
    );
    return { ...view, scroller, change, editor, listeners };
  }

  it("floats on the active change, follows it on scroll and edits, and stops listening when it goes", async () => {
    const { container, scroller, change, listeners, unmount } = setup();
    const bar = container.querySelector<HTMLElement>("[data-note-review]");
    expect(bar?.style.visibility).toBe("visible");
    expect(bar?.style.top).toBe(`${300 + REVIEW_GAP_PX}px`);
    expect(bar?.style.left).toBe("700px");

    place(change, { top: 100, bottom: 150, left: 100, right: 500 });
    fireEvent.scroll(scroller);
    await frame();
    expect(bar?.style.top).toBe(`${150 + REVIEW_GAP_PX}px`);
    expect(bar?.style.left).toBe("500px");

    place(change, { top: 500, bottom: 1500, left: 100, right: 500 });
    for (const listener of listeners) listener();
    await frame();
    expect(bar?.style.top).toBe(`${640 - REVIEW_GAP_PX}px`);

    place(change, { top: -300, bottom: 10, left: 100, right: 500 });
    fireEvent(window, new Event("resize"));
    await frame();
    expect(bar?.style.top).toBe(`${36 + REVIEW_GAP_PX}px`);

    unmount();
    expect(listeners.size).toBe(0);
  });

  it("waits centred above the composer while the active change has no place on screen, then moves onto it", async () => {
    const { container, scroller, change } = setup(false);
    const bar = container.querySelector<HTMLElement>("[data-note-review]");
    expect(bar?.style.visibility).toBe("visible");
    expect(bar?.style.top).toBe(`${640 - REVIEW_GAP_PX}px`);
    expect(bar?.style.left).toBe("450px");
    change.classList.add("note-diff-active");
    fireEvent.scroll(scroller);
    await frame();
    expect(bar?.style.top).toBe(`${300 + REVIEW_GAP_PX}px`);
    expect(bar?.style.left).toBe("700px");
  });

  it("settles and steps through changes from the floating bar", () => {
    const { editor } = setup();
    fireEvent.click(screen.getByRole("button", { name: enEditor.inlineAi.accept }));
    fireEvent.click(screen.getByRole("button", { name: enEditor.inlineAi.reject }));
    fireEvent.click(screen.getByRole("button", { name: enNotes.review.acceptAll }));
    fireEvent.click(screen.getByRole("button", { name: enNotes.review.rejectAll }));
    fireEvent.click(screen.getByRole("button", { name: enEditor.diff.nextChange }));
    fireEvent.click(screen.getByRole("button", { name: enEditor.diff.previousChange }));
    expect(suggestions.acceptActive).toHaveBeenCalledWith(editor);
    expect(suggestions.rejectActive).toHaveBeenCalledWith(editor);
    expect(suggestions.acceptAll).toHaveBeenCalledWith(editor);
    expect(suggestions.rejectAll).toHaveBeenCalledWith(editor);
    expect(suggestions.moveReview).toHaveBeenCalledWith(editor, 1);
    expect(suggestions.moveReview).toHaveBeenCalledWith(editor, -1);
    expect(editor.view.focus).toHaveBeenCalledTimes(4);
  });
});
