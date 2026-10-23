// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  closestMatchingElement,
  measuredTextOffset,
  textAroundWord,
  wordRangeAtHorizontalPosition,
  wordRangeInText,
} from "./textHit";

function wordInText(text: string, offset: number) {
  const range = wordRangeInText(text, offset);
  return range && text.slice(range.start, range.end);
}

function wordAtHorizontalPosition(text: string, left: number, width: number, clientX: number) {
  const range = wordRangeAtHorizontalPosition(text, left, width, clientX);
  return range && text.slice(range.start, range.end);
}

describe("PDF text hit testing", () => {
  it("finds a word at a text offset", () => {
    expect(wordInText("1 Introduction", 7)).toBe("Introduction");
  });

  it("maps a horizontal click to the matching word", () => {
    expect(wordAtHorizontalPosition("1 Introduction", 100, 140, 170)).toBe("Introduction");
  });

  it("clamps clicks outside the span", () => {
    expect(wordAtHorizontalPosition("First Last", 100, 100, 250)).toBe("Last");
  });

  it("finds the last word for an offset past the end of the text", () => {
    expect(wordInText("final word", 99)).toBe("word");
  });

  it("returns no word for a leading joiner or punctuation", () => {
    expect(wordInText("\u200Cword", 0)).toBeNull();
    expect(wordInText("  ,  ", 2)).toBeNull();
  });

  it("returns no word for empty text or a span without width", () => {
    expect(wordAtHorizontalPosition("", 0, 100, 10)).toBeNull();
    expect(wordAtHorizontalPosition("word", 0, 0, 10)).toBeNull();
  });

  it("accepts a cross-realm-like target without relying on instanceof", () => {
    const span = {} as Element;
    const target = {
      closest: (selector: string) => (selector === ".textLayer span" ? span : null),
    } as unknown as EventTarget;

    expect(closestMatchingElement(target, ".textLayer span")).toBe(span);
  });

  it("returns null for non-element event targets", () => {
    expect(closestMatchingElement({} as EventTarget, ".textLayer span")).toBeNull();
  });
});

describe("PDF click words across scripts", () => {
  it.each([
    ["Hindi with virama and matras", "नमस्ते दुनिया", 1, "नमस्ते"],
    ["Hindi clicked inside the word", "यह हिन्दी भाषा है", 5, "हिन्दी"],
    ["Thai with above-base vowels", "สวัสดีครับ", 0, "สวัสดีครับ"],
    ["Hebrew with niqqud", "שָׁלוֹם עולם", 1, "שָׁלוֹם"],
    ["Persian with a zero-width non-joiner", "می\u200Cخواهم رفتن", 0, "می\u200Cخواهم"],
    ["a CJK Extension B character", "𠮷野家です", 1, "𠮷野家です"],
    ["decomposed Latin", "cafe\u0301 noir", 2, "cafe\u0301"],
    ["an English contraction", "don’t stop", 1, "don"],
  ])("%s", (_label, text, offset, expected) => {
    expect(wordInText(text, offset)).toBe(expected);
  });

  it("does not extend a word across a joiner at its edge", () => {
    expect(wordInText("word\u200C next", 1)).toBe("word");
  });
});

describe("text around a clicked PDF word", () => {
  function layer(html: string) {
    const root = document.createElement("div");
    root.className = "textLayer";
    root.innerHTML = html;
    return root;
  }

  const page =
    '<span class="markedContent"><span>1 Introduction</span></span><br><span>Cats and dogs</span><span> </span><span>and birds</span><br><span>and fish.</span>';

  it("returns UTF-16 offsets for a word after an astral character", () => {
    expect(wordRangeInText("\u{20BB7}\u91ce cafe", 5)).toEqual({ start: 4, end: 8 });
    expect(wordRangeInText("  ,  ", 2)).toBeNull();
  });

  it("reads line ends as spaces and marked content in reading order", () => {
    const root = layer(page);
    const clicked = root.querySelectorAll("span:not(.markedContent)")[3];
    expect(textAroundWord(root, clicked, { start: 0, end: 3 })).toEqual({
      before: "1 Introduction Cats and dogs ",
      after: " birds and fish.",
    });
  });

  it("starts from the clicked text node as well as from its span", () => {
    const root = layer(page);
    const node = root.querySelectorAll("span:not(.markedContent)")[1].firstChild as Text;
    expect(textAroundWord(root, node, { start: 5, end: 8 })).toEqual({
      before: "1 Introduction Cats ",
      after: " dogs and birds and fish.",
    });
  });

  it("keeps only the nearest text on each side", () => {
    const root = layer(`<span>${"a ".repeat(300)}</span><span>word</span><span>${" b".repeat(300)}</span>`);
    const context = textAroundWord(root, root.children[1], { start: 0, end: 4 });
    expect(context.before).toHaveLength(200);
    expect(context.after).toHaveLength(200);
    expect(context.before.endsWith("a ")).toBe(true);
    expect(context.after.startsWith(" b")).toBe(true);
  });
});

describe("measuring the character under the pointer", () => {
  const original = Object.getOwnPropertyDescriptor(Range.prototype, "getBoundingClientRect");

  afterEach(() => {
    if (original) Object.defineProperty(Range.prototype, "getBoundingClientRect", original);
    else Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  });

  /** Lays `text` out from x = 100 with the given character widths. */
  function laidOut(text: string, widths: number[]): Text {
    const node = document.createTextNode(text);
    const edges = widths.reduce((all, width) => [...all, (all.at(-1) as number) + width], [100]);
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value(this: Range) {
        const left = edges[this.startOffset];
        const right = edges[this.endOffset];
        return { left, right, width: right - left, top: 0, bottom: 10, height: 10, x: left, y: 0 } as DOMRect;
      },
    });
    return node;
  }

  it("finds the character from the browser's layout, not from equal widths", () => {
    // Narrow letters then wide ones: at x = 150 the equal-width guess is in
    // "ill", the layout says "mmm".
    const text = "ill ill mmm";
    const node = laidOut(text, [3, 3, 3, 4, 3, 3, 3, 4, 30, 30, 30]);
    const offset = measuredTextOffset(node, 150);
    expect(offset).toBe(8);
    expect(wordAtHorizontalPosition(text, 100, 116, 150)).toBe("ill");
  });

  it("gives up without a layout, so the caller can estimate", () => {
    const node = document.createTextNode("no layout here");
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, right: 0, width: 0, top: 0, bottom: 0, height: 0 }),
    });
    expect(measuredTextOffset(node, 50)).toBeNull();
  });

  it("gives up on a run that does not read left to right", () => {
    const node = document.createTextNode("abc");
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value(this: Range) {
        const left = 200 - this.startOffset * 10;
        return { left, right: left + 10, width: 10, top: 0, bottom: 10, height: 10 } as DOMRect;
      },
    });
    expect(measuredTextOffset(node, 195)).toBeNull();
  });

  it("gives up on a point outside the run", () => {
    const node = laidOut("abc", [10, 10, 10]);
    expect(measuredTextOffset(node, 99)).toBeNull();
    expect(measuredTextOffset(node, 131)).toBeNull();
  });
});
