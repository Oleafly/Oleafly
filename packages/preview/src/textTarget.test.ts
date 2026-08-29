// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  caretTextOffsetAt,
  findTextLayerSpanAt,
  textTargetAtPoint,
  wordAtPoint,
} from "./textTarget";

type Rect = { left: number; top: number; width: number; height: number };

function makeLayer(spans: Array<{ text: string; rect: Rect }>) {
  const root = document.createElement("div");
  root.className = "textLayer";
  const elements = spans.map(({ text, rect }) => {
    const span = document.createElement("span");
    span.textContent = text;
    span.getBoundingClientRect = () =>
      ({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height,
        x: rect.left,
        y: rect.top,
        toJSON: () => ({}),
      }) as DOMRect;
    root.appendChild(span);
    return span;
  });
  document.body.appendChild(root);
  return { root, elements };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  delete (document as { caretRangeFromPoint?: unknown }).caretRangeFromPoint;
  delete (document as { caretPositionFromPoint?: unknown }).caretPositionFromPoint;
});

describe("findTextLayerSpanAt", () => {
  it("prefers the span the event actually hit over geometry", () => {
    const { root, elements } = makeLayer([
      { text: "first", rect: { left: 0, top: 0, width: 100, height: 20 } },
      { text: "second", rect: { left: 0, top: 0, width: 100, height: 20 } },
    ]);
    const target = { closest: (s: string) => (s === ".textLayer span" ? elements[1] : null) };

    expect(findTextLayerSpanAt(10, 10, target as unknown as EventTarget, root)).toBe(elements[1]);
  });

  it("falls back to the span whose rect contains the point", () => {
    const { root, elements } = makeLayer([
      { text: "left", rect: { left: 0, top: 0, width: 50, height: 20 } },
      { text: "right", rect: { left: 60, top: 0, width: 50, height: 20 } },
    ]);

    expect(findTextLayerSpanAt(80, 10, null, root)).toBe(elements[1]);
  });

  it("returns null when the point is outside every span", () => {
    const { root } = makeLayer([{ text: "only", rect: { left: 0, top: 0, width: 50, height: 20 } }]);

    expect(findTextLayerSpanAt(900, 900, null, root)).toBeNull();
  });
});

describe("caretTextOffsetAt", () => {
  it("uses caretRangeFromPoint when the range lands inside the span", () => {
    const { elements } = makeLayer([
      { text: "Introduction", rect: { left: 0, top: 0, width: 120, height: 20 } },
    ]);
    const span = elements[0];
    (document as { caretRangeFromPoint?: unknown }).caretRangeFromPoint = () => ({
      startContainer: span.firstChild as Node,
      startOffset: 5,
    });

    expect(caretTextOffsetAt(50, 10, span)).toBe(5);
  });

  it("falls back to caretPositionFromPoint when no range is available", () => {
    const { elements } = makeLayer([
      { text: "Introduction", rect: { left: 0, top: 0, width: 120, height: 20 } },
    ]);
    const span = elements[0];
    (document as { caretPositionFromPoint?: unknown }).caretPositionFromPoint = () => ({
      offsetNode: span.firstChild as Node,
      offset: 3,
    });

    expect(caretTextOffsetAt(50, 10, span)).toBe(3);
  });

  it("rejects a caret that resolves outside the span", () => {
    const { elements } = makeLayer([
      { text: "one", rect: { left: 0, top: 0, width: 30, height: 20 } },
      { text: "two", rect: { left: 40, top: 0, width: 30, height: 20 } },
    ]);
    (document as { caretRangeFromPoint?: unknown }).caretRangeFromPoint = () => ({
      startContainer: elements[1].firstChild as Node,
      startOffset: 2,
    });

    expect(caretTextOffsetAt(10, 10, elements[0])).toBeNull();
  });

  it("rejects a caret that resolves to an element rather than text", () => {
    const { elements } = makeLayer([
      { text: "one", rect: { left: 0, top: 0, width: 30, height: 20 } },
    ]);
    (document as { caretRangeFromPoint?: unknown }).caretRangeFromPoint = () => ({
      startContainer: elements[0],
      startOffset: 0,
    });

    expect(caretTextOffsetAt(10, 10, elements[0])).toBeNull();
  });

  it("returns null when the browser exposes neither caret API", () => {
    const { elements } = makeLayer([
      { text: "one", rect: { left: 0, top: 0, width: 30, height: 20 } },
    ]);

    expect(caretTextOffsetAt(10, 10, elements[0])).toBeNull();
  });
});

describe("textTargetAtPoint", () => {
  it("returns the caret offset when the browser reports one", () => {
    const { root, elements } = makeLayer([
      { text: "Introduction", rect: { left: 0, top: 0, width: 120, height: 20 } },
    ]);
    (document as { caretRangeFromPoint?: unknown }).caretRangeFromPoint = () => ({
      startContainer: elements[0].firstChild as Node,
      startOffset: 4,
    });

    expect(textTargetAtPoint(40, 10, null, root)).toEqual({ span: elements[0], offset: 4 });
  });

  it("interpolates the offset from the click position when no caret API answers", () => {
    const { root, elements } = makeLayer([
      { text: "abcd", rect: { left: 100, top: 0, width: 100, height: 20 } },
    ]);

    expect(textTargetAtPoint(150, 10, null, root)).toEqual({ span: elements[0], offset: 2 });
  });

  it("returns null when the click missed the text layer", () => {
    const { root } = makeLayer([
      { text: "abcd", rect: { left: 100, top: 0, width: 100, height: 20 } },
    ]);

    expect(textTargetAtPoint(900, 900, null, root)).toBeNull();
  });
});

describe("wordAtPoint", () => {
  it("reads the word under the click from the span geometry", () => {
    const { root } = makeLayer([
      { text: "1 Introduction", rect: { left: 100, top: 0, width: 140, height: 20 } },
    ]);

    expect(wordAtPoint(170, 10, null, root)).toBe("Introduction");
  });

  it("uses the caret node when the span yields no word at that position", () => {
    const { root, elements } = makeLayer([
      { text: "  ", rect: { left: 0, top: 0, width: 40, height: 20 } },
    ]);
    (document as { caretRangeFromPoint?: unknown }).caretRangeFromPoint = () => ({
      startContainer: elements[0].firstChild as Node,
      startOffset: 0,
    });

    expect(wordAtPoint(10, 10, null, root)).toBeNull();
  });

  it("falls back to caretPositionFromPoint when caretRangeFromPoint is missing", () => {
    const { root } = makeLayer([
      { text: "   ", rect: { left: 0, top: 0, width: 40, height: 20 } },
    ]);
    const detached = document.createElement("span");
    detached.textContent = "Conclusion";
    (document as { caretPositionFromPoint?: unknown }).caretPositionFromPoint = () => ({
      offsetNode: detached.firstChild as Node,
      offset: 2,
    });

    expect(wordAtPoint(10, 10, null, root)).toBeNull();
  });

  it("returns the trimmed span text when the caret lands outside the clicked span", () => {
    const { root, elements } = makeLayer([
      { text: " Methods ", rect: { left: 0, top: 0, width: 0, height: 20 } },
    ]);
    const clicked = { closest: (s: string) => (s === ".textLayer span" ? elements[0] : null) };
    const other = document.createElement("span");
    other.textContent = "elsewhere";
    (document as { caretRangeFromPoint?: unknown }).caretRangeFromPoint = () => ({
      startContainer: other.firstChild as Node,
      startOffset: 1,
    });

    expect(wordAtPoint(10, 10, clicked as unknown as EventTarget, root)).toBe("Methods");
  });

  it("reads the word from the caret text node when no span contains the point", () => {
    const { root } = makeLayer([
      { text: "far away", rect: { left: 500, top: 500, width: 50, height: 20 } },
    ]);
    const detached = document.createElement("span");
    detached.textContent = "Discussion";
    (document as { caretRangeFromPoint?: unknown }).caretRangeFromPoint = () => ({
      startContainer: detached.firstChild as Node,
      startOffset: 3,
    });

    expect(wordAtPoint(10, 10, null, root)).toBe("Discussion");
  });

  it("uses elementFromPoint as the last resort", () => {
    const { root } = makeLayer([
      { text: "far away", rect: { left: 500, top: 500, width: 50, height: 20 } },
    ]);
    const layer = document.createElement("div");
    layer.className = "textLayer";
    const span = document.createElement("span");
    span.textContent = " Appendix ";
    layer.appendChild(span);
    document.body.appendChild(layer);
    document.elementFromPoint = () => span;

    expect(wordAtPoint(10, 10, null, root)).toBe("Appendix");
  });

  it("returns null when nothing at the point yields text", () => {
    const { root } = makeLayer([
      { text: "far away", rect: { left: 500, top: 500, width: 50, height: 20 } },
    ]);
    document.elementFromPoint = () => null;

    expect(wordAtPoint(10, 10, null, root)).toBeNull();
  });
});
