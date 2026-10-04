// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { setEditorDocumentPath, setEditorView } from "@oleafly/editor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorViewportAnchor } from "./use-viewport-anchor";

const views: EditorView[] = [];

function editor(height = 200): { view: EditorView; posAtCoords: ReturnType<typeof vi.fn> } {
  const view = new EditorView({ state: EditorState.create({ doc: "line one\nline two\nline three" }), parent: document.body });
  views.push(view);
  vi.spyOn(view.scrollDOM, "getBoundingClientRect").mockReturnValue({
    left: 10,
    top: 20,
    width: 100,
    height,
  } as DOMRect);
  const posAtCoords = vi.fn((_coords: { x: number; y: number }, _precise?: boolean) => 9);
  view.posAtCoords = posAtCoords as unknown as EditorView["posAtCoords"];
  return { view, posAtCoords };
}

function show(view: EditorView | null, path: string | null) {
  act(() => {
    setEditorView(view);
    setEditorDocumentPath(path);
  });
}

function nextFrame() {
  act(() => {
    vi.advanceTimersToNextFrame();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => {
    setEditorView(null);
  });
  for (const view of views.splice(0)) view.destroy();
  vi.useRealTimers();
});

describe("useEditorViewportAnchor", () => {
  it("is null while no source editor is mounted", () => {
    const { result } = renderHook(() => useEditorViewportAnchor());
    expect(result.current).toBeNull();
  });

  it("reads the position at the middle of the viewport one frame after the document loads", () => {
    const { view, posAtCoords } = editor();
    const { result } = renderHook(() => useEditorViewportAnchor());
    show(view, "main.tex");
    expect(result.current).toBeNull();
    nextFrame();
    expect(result.current).toEqual({ path: "main.tex", pos: 9 });
    expect(posAtCoords).toHaveBeenLastCalledWith({ x: 60, y: 120 }, false);
  });

  it("reports nothing for a collapsed editor", () => {
    const { view } = editor(0);
    const { result } = renderHook(() => useEditorViewportAnchor());
    show(view, "main.tex");
    nextFrame();
    expect(result.current).toBeNull();
  });

  it("collapses a burst of scroll events into one measurement per frame", () => {
    const { view, posAtCoords } = editor();
    renderHook(() => useEditorViewportAnchor());
    show(view, "main.tex");
    nextFrame();
    posAtCoords.mockClear();
    for (let index = 0; index < 3; index++) view.scrollDOM.dispatchEvent(new Event("scroll"));
    nextFrame();
    expect(posAtCoords).toHaveBeenCalledOnce();
  });

  it("follows the editor to a new document and clears when it closes", () => {
    const first = editor();
    const second = editor();
    const { result } = renderHook(() => useEditorViewportAnchor());
    show(first.view, "a.tex");
    nextFrame();
    show(second.view, "b.tex");
    nextFrame();
    expect(result.current).toEqual({ path: "b.tex", pos: 9 });

    first.posAtCoords.mockClear();
    first.view.scrollDOM.dispatchEvent(new Event("scroll"));
    nextFrame();
    expect(first.posAtCoords).not.toHaveBeenCalled();

    show(null, null);
    expect(result.current).toBeNull();
  });

  it("stops measuring after unmount", () => {
    const { view, posAtCoords } = editor();
    const { unmount } = renderHook(() => useEditorViewportAnchor());
    show(view, "main.tex");
    unmount();
    nextFrame();
    view.scrollDOM.dispatchEvent(new Event("scroll"));
    nextFrame();
    expect(posAtCoords).not.toHaveBeenCalled();
  });
});
