// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { registerPdfTextSelection } from "./pdfTextSelection";

const normalizePdfText = (text: string) => text.normalize("NFKC");

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

    const unregister = registerPdfTextSelection(layer, 2, normalizePdfText);
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
    expect(layer).toHaveAttribute("aria-label", "Selectable text for PDF page 2");

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

    const unregister = registerPdfTextSelection(layer, 1, normalizePdfText);
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
    const unregister = registerPdfTextSelection(layer, 1, normalizePdfText);

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
    const unregister = registerPdfTextSelection(layer, 1, normalizePdfText);
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

    const unregisterFirst = registerPdfTextSelection(firstLayer, 1, normalizePdfText);
    const unregisterRemaining = registerPdfTextSelection(
      remainingLayer,
      2,
      normalizePdfText,
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
