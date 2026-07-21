import { describe, expect, it } from "vitest";
import { buildLines, buildParas, mode } from "./lines";
import type { TextItem } from "./types";

const it_ = (str: string, x: number, y: number, fontSize = 10): TextItem => ({
  str,
  x,
  y,
  width: str.length * fontSize * 0.5,
  height: fontSize,
  fontName: "F1",
  fontSize,
});

describe("buildLines", () => {
  it("groups items on the same baseline and orders by x", () => {
    const lines = buildLines([it_("world", 60, 700), it_("hello", 10, 700.3)]);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe("hello world");
  });

  it("splits distinct baselines top-to-bottom", () => {
    const lines = buildLines([it_("low", 10, 650), it_("high", 10, 700)]);
    expect(lines.map((l) => l.text)).toEqual(["high", "low"]);
  });

  it("keeps small raised scripts attached to their line", () => {
    const lines = buildLines([it_("x", 10, 700), it_("2", 18, 704, 6.5)]);
    expect(lines).toHaveLength(1);
  });

  it("drops whitespace-only items", () => {
    expect(buildLines([it_(" ", 10, 700)])).toHaveLength(0);
  });
});

describe("buildParas", () => {
  it("merges consecutive lines into one paragraph", () => {
    const paras = buildParas(buildLines([it_("one", 10, 700), it_("two", 10, 688)]));
    expect(paras).toHaveLength(1);
    expect(paras[0].text).toBe("one two");
  });

  it("splits on a vertical gap larger than 1.8x line height", () => {
    const paras = buildParas(buildLines([it_("a", 10, 700), it_("b", 10, 660)]));
    expect(paras).toHaveLength(2);
  });

  it("splits on a font size change", () => {
    const paras = buildParas(buildLines([it_("Heading", 10, 700, 14), it_("body", 10, 688)]));
    expect(paras).toHaveLength(2);
  });

  it("removes end-of-line hyphenation", () => {
    const paras = buildParas(buildLines([it_("hyphen-", 10, 700), it_("ation", 10, 688)]));
    expect(paras[0].text).toBe("hyphenation");
  });

  it("keeps hyphen before a capitalized word", () => {
    const paras = buildParas(buildLines([it_("Navier-", 10, 700), it_("Stokes", 10, 688)]));
    expect(paras[0].text).toBe("Navier-Stokes");
  });
});

describe("mode", () => {
  it("returns the most frequent value", () => {
    expect(mode([10, 10, 12])).toBe(10);
  });
});
