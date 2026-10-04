// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/locales/en/editor.json" with { type: "json" };

const mocks = vi.hoisted(() => ({ scroll: vi.fn() }));

vi.mock("@oleafly/editor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@oleafly/editor")>()),
  scrollEditorPositionLocally: mocks.scroll,
}));
vi.mock("../cm/theme", () => ({ editorTheme: () => [] }));

import { InlineDiffPreview } from "./InlineDiffPreview";

function previewView(container: HTMLElement): EditorView {
  const content = container.querySelector(".cm-content");
  const view = content ? EditorView.findFromDOM(content as HTMLElement) : null;
  if (!view) throw new Error("the diff preview editor is not mounted");
  return view;
}

beforeEach(() => {
  mocks.scroll.mockReset();
});

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

afterEach(async () => {
  cleanup();
  for (let frame = 0; frame < 3; frame++) await nextFrame();
});

describe("InlineDiffPreview", () => {
  it("shows the new text with the removed lines inline and scrolls to the first change", async () => {
    const { container } = render(
      <InlineDiffPreview path="main.tex" oldText={"a\nb\nc\n"} newText={"a\nB\nc\n"} />,
    );
    const view = previewView(container);
    expect(view.state.doc.toString()).toBe("a\nB\nc\n");
    expect(view.state.readOnly).toBe(true);
    expect(container.querySelector(".cm-deletedChunk")?.textContent).toContain("b");
    await waitFor(() => expect(mocks.scroll).toHaveBeenCalledWith(view, 2));
    expect(view.scrollDOM.getAttribute("aria-label")).toBeNull();
  });

  it("makes the scroller focusable under a name when asked", () => {
    const { container } = render(
      <InlineDiffPreview path="main.tex" oldText="a" newText="b" ariaLabel="Proposed change" />,
    );
    const view = previewView(container);
    expect(view.scrollDOM.tabIndex).toBe(0);
    expect(view.scrollDOM.getAttribute("aria-label")).toBe("Proposed change");
  });

  it("falls back to the requested line when nothing changed, clamped to the document", async () => {
    const text = "one\ntwo\nthree";
    const { container, rerender } = render(
      <InlineDiffPreview path="notes.md" oldText={text} newText={text} scrollToLine={2} />,
    );
    await waitFor(() => expect(mocks.scroll).toHaveBeenCalledWith(previewView(container), 4));

    mocks.scroll.mockReset();
    rerender(<InlineDiffPreview path="notes.md" oldText={text} newText={text} scrollToLine={99} />);
    await waitFor(() => expect(mocks.scroll).toHaveBeenCalledWith(previewView(container), 8));
  });

  it("does not scroll an unchanged preview without a target line", async () => {
    let frames = 0;
    const raf = window.requestAnimationFrame.bind(window);
    const spy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) =>
      raf((time) => {
        frames += 1;
        callback(time);
      }),
    );
    const { container } = render(<InlineDiffPreview path="a.txt" oldText="same" newText="same" scrollToLine={0} />);
    const view = previewView(container);
    await waitFor(() => expect(frames).toBeGreaterThanOrEqual(3));
    expect(mocks.scroll.mock.calls.filter(([target]) => target === view)).toEqual([]);
    spy.mockRestore();
  });

  it("explains instead of diffing very large text", () => {
    const { container } = render(
      <InlineDiffPreview path="big.tex" oldText={"x".repeat(400_001)} newText="y" />,
    );
    expect(screen.getByText(en.diff.previewTooLarge)).toBeInTheDocument();
    expect(container.querySelector(".cm-editor")).toBeNull();
  });

  it("does not scroll a preview that unmounted before its frames ran", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    const request = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    });
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    const runFrame = () => {
      const due = [...frames.values()];
      frames.clear();
      for (const callback of due) callback(0);
    };
    try {
      const { container, unmount } = render(
        <InlineDiffPreview path="main.tex" oldText={"a\nb\n"} newText={"a\nB\n"} />,
      );
      const view = previewView(container);
      runFrame();
      expect(frames.size).toBeGreaterThan(0);
      unmount();
      for (let pass = 0; pass < 10; pass++) runFrame();
      expect(mocks.scroll.mock.calls.some(([target]) => target === view)).toBe(false);
    } finally {
      request.mockRestore();
      cancel.mockRestore();
    }
  });

  it("removes the editor when it unmounts", () => {
    const { container, unmount } = render(
      <InlineDiffPreview path="main.tex" oldText="a" newText="b" className="h-10" />,
    );
    const host = container.firstElementChild as HTMLElement;
    expect(host).toHaveClass("h-10");
    expect(host.querySelector(".cm-editor")).not.toBeNull();
    unmount();
    expect(host.innerHTML).toBe("");
  });
});
