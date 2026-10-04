import { describe, expect, it } from "vitest";
import {
  maskNovalidateRegions,
  novalidateDirective,
  novalidateDirectiveAt,
  scanLatexNovalidate,
  skipNovalidateRegion,
} from "./latex-novalidate";

describe("novalidateDirective", () => {
  it.each([
    ["%novalidate", "file"],
    ["  %%  novalidate\t", "file"],
    ["% begin novalidate", "begin"],
    ["%end   novalidate\r", "end"],
    ["% novalidate please", null],
    ["text % novalidate", null],
    ["% begin  ", null],
  ])("reads %j as %s", (line, expected) => {
    expect(novalidateDirective(line)).toBe(expected);
  });
});

describe("novalidateDirectiveAt", () => {
  it("only accepts a comment that owns its line", () => {
    const text = "x\n  % novalidate\ntext % novalidate";
    const own = text.indexOf("%");
    expect(novalidateDirectiveAt(text, own, text.indexOf("\n", own))).toBe("file");
    const trailing = text.lastIndexOf("%");
    expect(novalidateDirectiveAt(text, trailing, text.length)).toBeNull();
    expect(novalidateDirectiveAt("% novalidate", 0, 12)).toBe("file");
  });
});

describe("skipNovalidateRegion", () => {
  it("resumes after the closing directive line", () => {
    const text = "% begin novalidate\n\\begin{x}\n% end novalidate\nafter";
    const from = text.indexOf("\n");
    expect(skipNovalidateRegion(text, from)).toBe(text.indexOf("after"));
  });

  it("runs to the end of the text when the region is never closed or closes on the last line", () => {
    const open = "% begin novalidate\nbroken {";
    expect(skipNovalidateRegion(open, open.indexOf("\n"))).toBe(open.length);
    const last = "% begin novalidate\n% end novalidate";
    expect(skipNovalidateRegion(last, last.indexOf("\n"))).toBe(last.length);
    expect(skipNovalidateRegion("abc", 3)).toBe(3);
  });
});

describe("scanLatexNovalidate", () => {
  it("disables the whole file for a bare directive", () => {
    expect(scanLatexNovalidate("text\n%novalidate\n\\begin{x}")).toEqual({ fileDisabled: true, regions: [] });
  });

  it("collects marked regions and ignores comments inside them", () => {
    const text = "a\n% begin novalidate\n% novalidate\n% end novalidate\nb\n% begin novalidate\nc";
    const scan = scanLatexNovalidate(text);
    expect(scan.fileDisabled).toBe(false);
    expect(scan.regions.map((region) => text.slice(region.from, region.to))).toEqual([
      "% begin novalidate\n% novalidate\n% end novalidate\n",
      "% begin novalidate\nc",
    ]);
  });

  it("ignores ordinary comments and an end directive without a start", () => {
    expect(scanLatexNovalidate("% note\n% end novalidate\ntext")).toEqual({ fileDisabled: false, regions: [] });
  });
});

describe("maskNovalidateRegions", () => {
  it("blanks region characters but keeps line breaks and the rest of the text", () => {
    const text = "keep\nhide me\nkeep";
    const from = text.indexOf("hide");
    expect(maskNovalidateRegions(text, [{ from, to: from + 8 }])).toBe("keep\n       \nkeep");
    expect(maskNovalidateRegions(text, [])).toBe(text);
  });
});
