// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { registerPdfTextSelection } from "./pdfTextSelection";
import type { PreviewMessageKey } from "./messages";

const normalizePdfText = (text: string) => text.normalize("NFKC");
const stubT = (key: PreviewMessageKey, params?: Record<string, string | number>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.getSelection()?.removeAllRanges();
});

describe("registerPdfTextSelection", () => {
  it("keeps a DOM Range selection active across spans and lines", () => {
    const layer = document.createElement("div");
    layer.className = "textLayer";
    const first = document.createElement("span");
    first.textContent = "Cross-span start ";
    const second = document.createElement("span");
    second.textContent = "continues here";
    const lineBreak = document.createElement("br");
    const third = document.createElement("span");
    third.textContent = "and reaches another line";
    layer.append(first, second, lineBreak, third);
    document.body.append(layer);

    const unregister = registerPdfTextSelection(layer, 2, normalizePdfText, stubT);
    layer.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

    const range = document.createRange();
    range.setStart(first.firstChild as Text, 6);
    range.setEnd(third.firstChild as Text, 11);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    expect(selection?.toString()).toContain("span start");
    expect(selection?.toString()).toContain("continues here");
    expect(selection?.toString()).toContain("and reaches");
    expect(layer).toHaveClass("selecting");
    expect(layer.tabIndex).toBe(0);
    expect(layer).toHaveAttribute("aria-label", 'a11y.textLayer {"page":2}');

    const end = layer.querySelector<HTMLElement>(".endOfContent");
    expect(end).not.toBeNull();
    expect(end?.previousSibling).toBe(third);

    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    expect(layer).not.toHaveClass("selecting");
    expect(layer.lastElementChild).toBe(end);
    expect(end?.style.userSelect).toBe("text");

    unregister();
  });

  it.each([
    {
      name: "an element boundary between text spans",
      boundary: 2,
      expectedNextText: "third",
    },
    {
      name: "blank space after the final text span",
      boundary: 4,
      expectedNextText: null,
    },
  ])("keeps the sentinel inside its text layer when selection ends at $name", ({
    boundary,
    expectedNextText,
  }) => {
    const layer = document.createElement("div");
    layer.className = "textLayer";
    const first = document.createElement("span");
    first.textContent = "first";
    const second = document.createElement("span");
    second.textContent = "second";
    const third = document.createElement("span");
    third.textContent = "third";
    layer.append(first, second, third);
    document.body.append(layer);

    const unregister = registerPdfTextSelection(layer, 1, normalizePdfText, stubT);
    const sentinel = layer.querySelector<HTMLDivElement>(".endOfContent");
    expect(sentinel).not.toBeNull();

    const range = document.createRange();
    range.setStart(first.firstChild as Text, 0);
    range.setEnd(layer, Math.min(boundary, layer.childNodes.length));
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    expect(sentinel?.parentElement).toBe(layer);
    expect(sentinel?.nextSibling?.textContent ?? null).toBe(expectedNextText);
    expect(document.body.contains(sentinel)).toBe(true);

    unregister();
  });

  it("normalizes Unicode and removes null characters when copying", () => {
    const layer = document.createElement("div");
    layer.className = "textLayer";
    const text = document.createTextNode("ﬁ\0nal");
    layer.append(text);
    document.body.append(layer);
    const unregister = registerPdfTextSelection(layer, 1, normalizePdfText, stubT);

    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const setData = vi.fn();
    const event = new Event("copy", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", {
      value: { setData },
    });
    layer.dispatchEvent(event);

    expect(setData).toHaveBeenCalledWith("text/plain", "final");
    expect(event.defaultPrevented).toBe(true);

    unregister();
  });

  it("leaves the sentinel fixed when Firefox owns cross-span selection", () => {
    const layer = document.createElement("div");
    layer.className = "textLayer";
    const first = document.createElement("span");
    first.textContent = "first";
    const second = document.createElement("span");
    second.textContent = "second";
    layer.append(first, second);
    document.body.append(layer);
    const unregister = registerPdfTextSelection(layer, 1, normalizePdfText, stubT);
    const sentinel = layer.querySelector<HTMLDivElement>(".endOfContent");
    const getComputedStyle = vi.spyOn(window, "getComputedStyle").mockImplementation(
      (element) =>
        ({
          getPropertyValue: (property: string) =>
            element === sentinel && property === "-moz-user-select" ? "none" : "auto",
        }) as CSSStyleDeclaration,
    );

    const range = document.createRange();
    range.setStart(first.firstChild as Text, 0);
    range.setEnd(first.firstChild as Text, 3);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    expect(getComputedStyle).toHaveBeenCalledWith(sentinel);
    expect(getComputedStyle).not.toHaveBeenCalledWith(layer);
    expect(layer.lastElementChild).toBe(sentinel);
    unregister();
  });

  it("clears the prior range when its selected page is unregistered", () => {
    const firstLayer = document.createElement("div");
    firstLayer.className = "textLayer";
    const firstText = document.createElement("span");
    firstText.textContent = "evicted page";
    firstLayer.append(firstText);

    const remainingLayer = document.createElement("div");
    remainingLayer.className = "textLayer";
    const remainingText = document.createElement("span");
    remainingText.textContent = "remaining page";
    remainingLayer.append(remainingText);
    document.body.append(firstLayer, remainingLayer);

    const unregisterFirst = registerPdfTextSelection(firstLayer, 1, normalizePdfText, stubT);
    const unregisterRemaining = registerPdfTextSelection(
      remainingLayer,
      2,
      normalizePdfText,
      stubT,
    );
    const firstRange = document.createRange();
    firstRange.selectNodeContents(firstText);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(firstRange);
    document.dispatchEvent(new Event("selectionchange"));

    unregisterFirst();
    firstLayer.remove();

    const remainingRange = document.createRange();
    remainingRange.selectNodeContents(remainingText);
    const compare = vi.spyOn(remainingRange, "compareBoundaryPoints");
    selection?.removeAllRanges();
    selection?.addRange(remainingRange);
    expect(() => document.dispatchEvent(new Event("selectionchange"))).not.toThrow();
    expect(compare).not.toHaveBeenCalled();
    expect(remainingLayer).toHaveClass("selecting");

    unregisterRemaining();
  });
});

describe("registerPdfTextSelection global selection handling", () => {
  function textLayer(...labels: string[]) {
    const layer = document.createElement("div");
    layer.className = "textLayer";
    const spans = labels.map((label) => {
      const span = document.createElement("span");
      span.textContent = label;
      layer.append(span);
      return span;
    });
    document.body.append(layer);
    return { layer, spans };
  }

  function select(startNode: Node, startOffset: number, endNode: Node, endOffset: number) {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    return range;
  }

  it("resets every layer when the selection is cleared", () => {
    const { layer, spans } = textLayer("first", "second");
    const unregister = registerPdfTextSelection(layer, 1, normalizePdfText, stubT);
    const sentinel = layer.querySelector(".endOfContent");
    select(spans[0].firstChild as Text, 0, spans[1].firstChild as Text, 3);
    expect(layer).toHaveClass("selecting");

    document.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));

    expect(layer).not.toHaveClass("selecting");
    expect(layer.lastElementChild).toBe(sentinel);
    unregister();
  });

  it("resets on key release or window blur unless a pointer drag is in progress", () => {
    const { layer, spans } = textLayer("first", "second");
    const unregister = registerPdfTextSelection(layer, 1, normalizePdfText, stubT);

    select(spans[0].firstChild as Text, 0, spans[1].firstChild as Text, 3);
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift" }));
    expect(layer).not.toHaveClass("selecting");

    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    select(spans[0].firstChild as Text, 0, spans[1].firstChild as Text, 4);
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift" }));
    expect(layer).toHaveClass("selecting");

    window.dispatchEvent(new Event("blur"));
    expect(layer).not.toHaveClass("selecting");
    unregister();
  });

  it("places the sentinel before the start when the selection start moves", () => {
    const { layer, spans } = textLayer("first", "second", "third");
    const unregister = registerPdfTextSelection(layer, 1, normalizePdfText, stubT);
    const sentinel = layer.querySelector(".endOfContent");
    const third = spans[2].firstChild as Text;

    select(spans[1].firstChild as Text, 2, third, 3);
    select(spans[0].firstChild as Text, 1, third, 3);

    expect(sentinel?.nextSibling).toBe(spans[0]);
    unregister();
  });

  it("walks back to the previous text run when a selection ends at the start of a span", () => {
    const { layer, spans } = textLayer("first", "second", "third");
    const unregister = registerPdfTextSelection(layer, 1, normalizePdfText, stubT);
    const sentinel = layer.querySelector(".endOfContent");

    select(spans[0].firstChild as Text, 1, spans[2].firstChild as Text, 0);

    expect(sentinel?.previousSibling).toBe(spans[1]);
    expect(sentinel?.nextSibling).toBe(spans[2]);
    unregister();
  });

  it("anchors on the run that contains a search highlight", () => {
    const { layer, spans } = textLayer("first", "");
    const highlight = document.createElement("span");
    highlight.className = "highlight";
    highlight.textContent = "match";
    spans[1].append(highlight);
    const unregister = registerPdfTextSelection(layer, 1, normalizePdfText, stubT);
    const sentinel = layer.querySelector(".endOfContent");

    select(spans[0].firstChild as Text, 0, highlight.firstChild as Text, 2);

    expect(sentinel?.parentElement).toBe(layer);
    expect(sentinel?.previousSibling).toBe(spans[1]);
    unregister();
  });

  it("leaves the sentinel alone when the selection ends outside every text layer", () => {
    const { layer, spans } = textLayer("first");
    const outside = document.createElement("p");
    outside.textContent = "outside the PDF";
    document.body.append(outside);
    const unregister = registerPdfTextSelection(layer, 1, normalizePdfText, stubT);
    const sentinel = layer.querySelector(".endOfContent");

    select(spans[0].firstChild as Text, 0, outside.firstChild as Text, 3);

    expect(layer).toHaveClass("selecting");
    expect(layer.lastElementChild).toBe(sentinel);
    unregister();
  });

  it("leaves an idle text layer untouched while the editor caret moves", () => {
    const { layer } = textLayer("first", "second");
    const editor = document.createElement("p");
    editor.textContent = "typing in the editor";
    document.body.append(editor);
    const unregister = registerPdfTextSelection(layer, 1, normalizePdfText, stubT);
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((batch) => records.push(...batch));
    observer.observe(layer, { attributes: true, childList: true, subtree: true });

    for (let offset = 1; offset <= 3; offset++) {
      select(editor.firstChild as Text, offset, editor.firstChild as Text, offset);
      document.dispatchEvent(new KeyboardEvent("keyup", { key: "a" }));
    }
    records.push(...observer.takeRecords());
    observer.disconnect();

    expect(records).toEqual([]);
    unregister();
  });

  it("ignores a stale unregister after the layer was registered again", () => {
    const { layer, spans } = textLayer("first", "second");
    const staleUnregister = registerPdfTextSelection(layer, 1, normalizePdfText, stubT);
    const unregister = registerPdfTextSelection(layer, 1, normalizePdfText, stubT);

    staleUnregister();
    select(spans[0].firstChild as Text, 0, spans[1].firstChild as Text, 2);

    expect(layer).toHaveClass("selecting");
    unregister();
    document.getSelection()?.removeAllRanges();
    layer.classList.remove("selecting");
    document.dispatchEvent(new Event("selectionchange"));
    select(spans[0].firstChild as Text, 0, spans[1].firstChild as Text, 2);
    expect(layer).not.toHaveClass("selecting");
  });
});
