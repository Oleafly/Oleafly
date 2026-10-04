import { describe, it, expect } from "vitest";
import { buildIndex, indexFromSymbols } from "./build";
import { outlineFromIndex } from "./outline";

describe("outlineFromIndex", () => {
  it("walks includes and emits sections in document order across files", () => {
    const idx = buildIndex({
      "main.tex": "\\section{A}\n\\input{sec}\n\\section{B}",
      "sec.tex": "\\subsection{Sub}",
    });
    const o = outlineFromIndex(idx, "main.tex");
    expect(o.map((i) => i.title)).toEqual(["A", "Sub", "B"]);
    expect(o[1].file).toBe("sec.tex");
    expect(o[1].level).toBe(3);
  });

  it("emits a file entry for an include with no headings", () => {
    const idx = buildIndex({ "main.tex": "\\input{data}", "data.tex": "no headings here" });
    const o = outlineFromIndex(idx, "main.tex");
    expect(o).toHaveLength(1);
    expect(o[0].kind).toBe("file");
    expect(o[0].title).toBe("data.tex");
  });

  it("is cycle-guarded", () => {
    const idx = buildIndex({ "a.tex": "\\section{X}\\input{b}", "b.tex": "\\input{a}" });
    expect(() => outlineFromIndex(idx, "a.tex")).not.toThrow();
  });
});

describe("outlineFromIndex with sparse symbols", () => {
  it("defaults the section level and falls back to the include name", () => {
    const section = { kind: "section", name: "Loose", file: "main.tex", line: 1, from: 0, to: 5, nameFrom: 0, nameTo: 5 } as const;
    const edge = { kind: "inputedge", name: "part.tex", file: "main.tex", line: 2, from: 6, to: 12, nameFrom: 6, nameTo: 12 } as const;
    const idx = indexFromSymbols([section], [edge]);
    expect(outlineFromIndex(idx, "main.tex")).toEqual([
      { level: 2, title: "Loose", line: 1, file: "main.tex", kind: "section", from: 0, to: 5 },
      { level: 2, title: "part.tex", line: 2, file: "part.tex", kind: "file", from: 0, to: 0 },
    ]);
  });
});
