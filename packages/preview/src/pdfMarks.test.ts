// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clientBoxToPageRect,
  describePdfSelection,
  markFraction,
  paintPdfMarks,
  type PdfMark,
  snapRangeToWords,
  snapSelectionToWords,
} from "./pdfMarks";

const upright = {
  viewBox: [0, 0, 612, 792],
  width: 612,
  height: 792,
  convertToViewportPoint: (x: number, y: number) => [x, 792 - y],
};

const quarterTurn = {
  viewBox: [0, 0, 612, 792],
  width: 792,
  height: 612,
  convertToViewportPoint: (x: number, y: number) => [792 - y, 612 - x],
};

function domRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

function pageWrap(page: number, rect: DOMRect): HTMLElement {
  const wrap = document.createElement("div");
  wrap.dataset.page = String(page);
  wrap.getBoundingClientRect = () => rect;
  document.body.appendChild(wrap);
  return wrap;
}

const toPagePoint = (wrap: HTMLElement, page: number, point: { clientX: number; clientY: number }) => {
  const r = wrap.getBoundingClientRect();
  return { page, x: point.clientX - r.left, y: point.clientY - r.top };
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("markFraction", () => {
  it("places a SyncTeX box as fractions of an upright page", () => {
    const box = markFraction({ page: 1, x: 61.2, y: 79.2, width: 306, height: 39.6 }, upright);
    expect(box?.left).toBeCloseTo(0.1);
    expect(box?.top).toBeCloseTo(0.1);
    expect(box?.width).toBeCloseTo(0.5);
    expect(box?.height).toBeCloseTo(0.05);
  });

  it("follows a rotated page", () => {
    const box = markFraction({ page: 1, x: 0, y: 0, width: 61.2, height: 79.2 }, quarterTurn);
    expect(box?.left).toBeCloseTo(0);
    expect(box?.top).toBeCloseTo(0.9);
    expect(box?.width).toBeCloseTo(0.1);
    expect(box?.height).toBeCloseTo(0.1);
  });

  it("gives a flat box a visible height", () => {
    const box = markFraction({ page: 1, x: 0, y: 100, width: 100, height: 0 }, upright);
    expect(box?.height).toBeCloseTo(4 / 792);
  });

  it("refuses geometry without a size", () => {
    expect(markFraction({ page: 1, x: 0, y: 0, width: 1, height: 1 }, { ...upright, width: 0 })).toBeNull();
  });
});

describe("paintPdfMarks", () => {
  const marks: PdfMark[] = [
    {
      id: "a",
      label: "1",
      rects: [
        { page: 1, x: 10, y: 10, width: 100, height: 12 },
        { page: 1, x: 10, y: 24, width: 80, height: 12 },
      ],
    },
    { id: "b", label: "2", rects: [{ page: 2, x: 0, y: 0, width: 10, height: 10 }], active: true },
  ];

  it("draws the marks on its page with one badge each, in percentages", () => {
    const wrap = pageWrap(1, domRect(0, 0, 612, 792));
    const onActivate = vi.fn();
    paintPdfMarks(wrap, 1, upright, marks, { badgeLabel: (mark) => `Annotation ${mark.label}`, onActivate });

    const layer = wrap.querySelector(".pdf-mark-layer") as HTMLElement;
    expect(layer).not.toBeNull();
    const highlights = layer.querySelectorAll<HTMLElement>(".pdf-mark");
    expect(highlights).toHaveLength(2);
    expect(highlights[0].style.left).toMatch(/%$/u);
    const badges = layer.querySelectorAll<HTMLButtonElement>(".pdf-mark-badge");
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe("1");
    expect(badges[0].getAttribute("aria-label")).toBe("Annotation 1");
    expect(badges[0].style.fontSize).toMatch(/rem$/u);

    badges[0].click();
    expect(onActivate).toHaveBeenCalledWith("a");
  });

  it("keeps a badge click from reaching the page", () => {
    const wrap = pageWrap(1, domRect(0, 0, 612, 792));
    const pageClick = vi.fn();
    wrap.addEventListener("click", pageClick);
    paintPdfMarks(wrap, 1, upright, marks, { badgeLabel: () => "" });
    wrap.querySelector<HTMLButtonElement>(".pdf-mark-badge")?.click();
    expect(pageClick).not.toHaveBeenCalled();
  });

  it("replaces its layer when painted again, and clears it when nothing is left", () => {
    const wrap = pageWrap(1, domRect(0, 0, 612, 792));
    paintPdfMarks(wrap, 1, upright, marks, { badgeLabel: () => "" });
    paintPdfMarks(wrap, 1, upright, marks, { badgeLabel: () => "" });
    expect(wrap.querySelectorAll(".pdf-mark-layer")).toHaveLength(1);

    paintPdfMarks(wrap, 1, upright, [], { badgeLabel: () => "" });
    expect(wrap.querySelector(".pdf-mark-layer")).toBeNull();
  });

  it("waits for the page geometry", () => {
    const wrap = pageWrap(1, domRect(0, 0, 612, 792));
    paintPdfMarks(wrap, 1, undefined, marks, { badgeLabel: () => "" });
    expect(wrap.querySelector(".pdf-mark-layer")).toBeNull();
  });
});

describe("clientBoxToPageRect", () => {
  it("normalises the corners into a box on the page", () => {
    const wrap = pageWrap(3, domRect(20, 40, 612, 792));
    const flipped = (_wrap: HTMLElement, page: number, point: { clientX: number; clientY: number }) => ({
      page,
      x: 612 - (point.clientX - 20),
      y: point.clientY - 40,
    });
    const rect = clientBoxToPageRect(
      { left: 120, top: 140, right: 220, bottom: 160, width: 100, height: 20 },
      3,
      wrap,
      flipped,
    );
    expect(rect).toEqual({ page: 3, x: 412, y: 100, width: 100, height: 20 });
  });
});

describe("describePdfSelection", () => {
  function textPage(container: HTMLElement, page: number, bounds: DOMRect, ...lines: string[]) {
    const wrap = document.createElement("div");
    wrap.dataset.page = String(page);
    const bound = vi.fn(() => bounds);
    wrap.getBoundingClientRect = bound;
    const layer = document.createElement("div");
    layer.className = "textLayer";
    for (const line of lines) {
      const span = document.createElement("span");
      span.textContent = line;
      layer.append(span, document.createElement("br"));
    }
    wrap.append(layer);
    container.append(wrap);
    return { wrap, bound, texts: Array.from(layer.querySelectorAll("span"), (span) => span.firstChild as Text) };
  }

  function selectionOf(range: Range, rects: DOMRect[], text = range.toString()): Selection {
    range.getClientRects = () => rects as unknown as DOMRectList;
    return {
      isCollapsed: range.collapsed,
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => text,
    } as unknown as Selection;
  }

  function setup() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const one = textPage(container, 1, domRect(0, 0, 612, 792), "First page text.");
    const two = textPage(container, 2, domRect(0, 800, 612, 792), "  The  quick brown", "fox jumps over the lazy dog");
    const three = textPage(container, 3, domRect(0, 1600, 612, 792), "Third page");
    return { container, one, two, three };
  }

  it("reports the selected words on their page with both ends and the text around them", () => {
    const { container, two, three, one } = setup();
    const range = document.createRange();
    range.setStart(two.texts[0], 2);
    range.setEnd(two.texts[1], 3);
    const selection = selectionOf(
      range,
      [domRect(100, 900, 200, 12), domRect(100, 914, 50, 12), domRect(100, 1700, 50, 12), domRect(0, 0, 0, 0)],
      "The  quick brown\nfox",
    );

    const info = describePdfSelection(selection, container, toPagePoint, (text) => text);

    expect(info).not.toBeNull();
    expect(info?.page).toBe(2);
    expect(info?.text).toBe("The quick brown fox");
    expect(info?.before).toBe("");
    expect(info?.after).toBe(" jumps over the lazy dog");
    expect(info?.rects).toEqual([
      { page: 2, x: 100, y: 100, width: 200, height: 12 },
      { page: 2, x: 100, y: 114, width: 50, height: 12 },
    ]);
    expect(info?.start).toEqual({ page: 2, x: 101, y: 106 });
    expect(info?.end).toEqual({ page: 2, x: 149, y: 120 });
    expect(info?.clientRect).toEqual({ left: 100, top: 900, width: 200, height: 26 });
    expect(three.bound).not.toHaveBeenCalled();
    expect(one.bound).not.toHaveBeenCalled();
  });

  it("keeps up to 32 characters of collapsed context on each side, with the space next to the selection", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const long = "a".repeat(40);
    const page = textPage(container, 1, domRect(0, 0, 612, 792), `${long}  x   middle`, `tail  end ${long}`);
    const range = document.createRange();
    range.setStart(page.texts[0], 46);
    range.setEnd(page.texts[0], 52);
    const info = describePdfSelection(
      selectionOf(range, [domRect(10, 10, 40, 10)]),
      container,
      toPagePoint,
      (text) => text,
    );
    expect(info?.text).toBe("middle");
    expect(info?.before).toBe(`${"a".repeat(29)} x `);
    expect(info?.after).toBe(` tail end ${"a".repeat(22)}`);
  });

  it("puts boxes on the start and end pages of a selection across a page break", () => {
    const { container, one, two } = setup();
    const range = document.createRange();
    range.setStart(one.texts[0], 6);
    range.setEnd(two.texts[0], 7);
    const info = describePdfSelection(
      selectionOf(range, [domRect(10, 700, 60, 12), domRect(10, 820, 40, 12)]),
      container,
      toPagePoint,
      (text) => text,
    );
    expect(info?.rects).toEqual([
      { page: 1, x: 10, y: 700, width: 60, height: 12 },
      { page: 2, x: 10, y: 20, width: 40, height: 12 },
    ]);
    expect(info?.before).toBe("First ");
    expect(info?.after).toBe("quick brown fox jumps over the l");
  });

  it("ignores a selection outside the PDF or without text", () => {
    const { container, two } = setup();
    const outside = document.createElement("p");
    outside.textContent = "elsewhere";
    document.body.appendChild(outside);
    const away = document.createRange();
    away.selectNodeContents(outside);
    expect(describePdfSelection(selectionOf(away, [domRect(1, 1, 5, 5)]), container, toPagePoint, (text) => text)).toBeNull();

    const blank = document.createRange();
    blank.setStart(two.texts[0], 0);
    blank.setEnd(two.texts[0], 2);
    expect(describePdfSelection(selectionOf(blank, [domRect(10, 810, 20, 10)]), container, toPagePoint, (text) => text)).toBeNull();

    const collapsed = { isCollapsed: true, rangeCount: 1 } as unknown as Selection;
    expect(describePdfSelection(collapsed, container, toPagePoint, (text) => text)).toBeNull();
  });
});

describe("snapping a selection to words", () => {
  function textRange(node: Text, start: number, end: number, endNode: Text = node): Range {
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(endNode, end);
    return range;
  }

  it("widens both ends to whole words", () => {
    const node = document.createTextNode("The quick brown fox");
    expect(snapRangeToWords(textRange(node, 6, 12))).toEqual({ start: 4, end: 15 });
  });

  it("leaves ends already on a word boundary or on spaces", () => {
    const node = document.createTextNode("The quick brown fox");
    expect(snapRangeToWords(textRange(node, 4, 9))).toBeNull();
    expect(snapRangeToWords(textRange(node, 3, 10))).toBeNull();
  });

  it("follows Unicode letters and marks", () => {
    const node = document.createTextNode("naïve Größe 数学");
    expect(snapRangeToWords(textRange(node, 2, 8))).toEqual({ start: 0, end: 11 });
  });

  it("updates the document selection, keeping its direction", () => {
    const container = document.createElement("div");
    const first = document.createElement("span");
    first.textContent = "alpha beta";
    const second = document.createElement("span");
    second.textContent = "gamma delta";
    container.append(first, second);
    document.body.appendChild(container);
    const a = first.firstChild as Text;
    const b = second.firstChild as Text;
    const selection = document.getSelection() as Selection;

    selection.setBaseAndExtent(a, 7, b, 2);
    expect(snapSelectionToWords(selection, container)).toBe(true);
    expect(selection.toString()).toBe("betagamma");
    expect([selection.anchorOffset, selection.focusOffset]).toEqual([6, 5]);

    selection.setBaseAndExtent(b, 2, a, 8);
    expect(snapSelectionToWords(selection, container)).toBe(true);
    expect(selection.anchorNode).toBe(b);
    expect([selection.anchorOffset, selection.focusOffset]).toEqual([5, 6]);

    expect(snapSelectionToWords(selection, container)).toBe(false);
  });

  it("leaves a selection outside the container alone", () => {
    const outside = document.createElement("p");
    outside.textContent = "outside words";
    document.body.appendChild(outside);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const selection = document.getSelection() as Selection;
    selection.setBaseAndExtent(outside.firstChild as Text, 2, outside.firstChild as Text, 5);
    expect(snapSelectionToWords(selection, container)).toBe(false);
    expect(selection.toString()).toBe("tsi");
  });
});

describe("markFraction with incomplete geometry", () => {
  it("places nothing instead of failing", () => {
    const partial = { width: 612, height: 792 } as unknown as Parameters<typeof markFraction>[1];
    expect(markFraction({ page: 1, x: 0, y: 0, width: 1, height: 1 }, partial)).toBeNull();
  });
});
