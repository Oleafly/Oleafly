import { describe, expect, it } from "vitest";
import {
  emitLatexTable,
  emitTypstTable,
  escapeLatexCell,
  escapeTypstCell,
  inferAlignment,
  parseDelimited,
} from "./table.ts";

describe("parseDelimited", () => {
  it("splits plain CSV and trims cells", () => {
    expect(parseDelimited("a, b ,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("keeps quoted commas inside one cell and un-doubles quotes", () => {
    const rows = parseDelimited('name,note\n"Doe, Jane","said ""hi"""');
    expect(rows).toEqual([
      ["name", "note"],
      ["Doe, Jane", 'said "hi"'],
    ]);
  });

  it("stitches quoted newlines into one cell", () => {
    const rows = parseDelimited('id,text\n1,"line one\nline two"\n2,flat');
    expect(rows).toEqual([
      ["id", "text"],
      ["1", "line one\nline two"],
      ["2", "flat"],
    ]);
  });

  it("uses tabs when the first line has one", () => {
    expect(parseDelimited("a\tb, c\n1\t2, 3")).toEqual([
      ["a", "b, c"],
      ["1", "2, 3"],
    ]);
  });

  it("does not mistake a quoted tab for a TSV delimiter", () => {
    expect(parseDelimited('"Tab\tlabel",Score\nmethod,1')).toEqual([
      ["Tab\tlabel", "Score"],
      ["method", "1"],
    ]);
  });

  it("drops trailing blank lines and keeps unicode verbatim", () => {
    expect(parseDelimited("α,β\nγ,δ\n\n")).toEqual([
      ["α", "β"],
      ["γ", "δ"],
    ]);
  });
});

describe("escapeLatexCell", () => {
  it("escapes every special exactly once", () => {
    const input = "a&b%c$d#e_f{g}h~i^j\\k";
    const output = escapeLatexCell(input);
    expect(output).toBe(
      "a\\&b\\%c\\$d\\#e\\_f\\{g\\}h\\textasciitilde{}i\\textasciicircum{}j\\textbackslash{}k",
    );
  });

  it("does not re-escape the braces it inserts (single pass)", () => {
    const output = escapeLatexCell("\\");
    expect(output).toBe("\\textbackslash{}");
    expect(output).not.toContain("textbackslash\\{");
  });

  it("preserves ordinary Unicode while escaping mixed special characters", () => {
    expect(escapeLatexCell("αβγ—é & 50% $x^2$ #1_a {b}~\\")).toBe(
      "αβγ—é \\& 50\\% \\$x\\textasciicircum{}2\\$ \\#1\\_a \\{b\\}\\textasciitilde{}\\textbackslash{}",
    );
  });

  it("joins embedded newlines with a space", () => {
    expect(escapeLatexCell("line one\nline two")).toBe("line one line two");
  });
});

describe("escapeTypstCell", () => {
  it("escapes Typst markup characters", () => {
    expect(escapeTypstCell("a[b]#d$e*f_g`h@i\\j")).toBe(
      "a\\[b\\]\\#d\\$e\\*f\\_g\\`h\\@i\\\\j",
    );
  });
});

describe("inferAlignment", () => {
  it("right-aligns numeric columns and left-aligns text", () => {
    const rows = [
      ["Name", "Score", "Note"],
      ["alpha", "12.5", "x"],
      ["beta", "7", "y"],
    ];
    expect(inferAlignment(rows, true)).toBe("lrl");
  });

  it("treats thousand separators and percents as numeric", () => {
    const rows = [
      ["h1", "h2"],
      ["1,234", "45%"],
      ["9,876", "51%"],
    ];
    expect(inferAlignment(rows, true)).toBe("rr");
  });

  it("does not spend unbounded time on repeated separators", () => {
    const rows = [["value"], [`1${",".repeat(20_000)}1`]];
    expect(inferAlignment(rows, true)).toBe("l");
  });
});

describe("emitLatexTable", () => {
  it("emits booktabs with a bold header, caption, and label", () => {
    const latex = emitLatexTable(
      [
        ["Method", "Accuracy"],
        ["ours", "0.94"],
      ],
      { header: true, caption: "Results", label: "tab:results" },
    );
    expect(latex).toContain("\\begin{table}[htbp]");
    expect(latex).toContain("\\caption{Results}");
    expect(latex).toContain("\\label{tab:results}");
    expect(latex).toContain("\\begin{tabular}{lr}");
    expect(latex).toContain("\\toprule");
    expect(latex).toContain("\\textbf{Method} & \\textbf{Accuracy} \\\\");
    expect(latex).toContain("\\midrule");
    expect(latex).toContain("ours & 0.94 \\\\");
    expect(latex).toContain("\\bottomrule");
  });

  it("escapes specials in emitted cells", () => {
    const latex = emitLatexTable([["R&D"], ["50%_done"]], { header: true });
    expect(latex).toContain("\\textbf{R\\&D}");
    expect(latex).toContain("50\\%\\_done");
  });

  it("escapes captions and declines unsafe labels", () => {
    const latex = emitLatexTable([["A"]], {
      header: true,
      caption: "Results & 50%",
      label: "tab:x}\\input{untrusted}",
    });
    expect(latex).toContain("\\caption{Results \\& 50\\%}");
    expect(latex).not.toContain("\\label{");
  });

  it("falls back to inferred alignment for invalid explicit values", () => {
    const latex = emitLatexTable([["Value"], ["1"]], {
      header: true,
      alignment: "r}\\input{untrusted}",
    });
    expect(latex).toContain("\\begin{tabular}{r}");
  });

  it("pads ragged rows", () => {
    const latex = emitLatexTable([["a", "b", "c"], ["only-one"]], { header: true });
    expect(latex).toContain("only-one &  &  \\\\");
  });
});

describe("emitTypstTable", () => {
  it("emits a table with a strong header and alignment", () => {
    const typst = emitTypstTable(
      [
        ["Method", "Score"],
        ["ours", "0.94"],
      ],
      { header: true, caption: "Results" },
    );
    expect(typst).toContain("#table(");
    expect(typst).toContain("columns: (left, right),");
    expect(typst).toContain("table.header([*Method*], [*Score*]),");
    expect(typst).toContain("[ours], [0.94],");
    expect(typst).toContain("caption: [Results],");
  });

  it("escapes Typst markup in cells", () => {
    const typst = emitTypstTable([["a[b]"]], { header: false });
    expect(typst).toContain("[a\\[b\\]]");
  });

  it("escapes Typst captions", () => {
    const typst = emitTypstTable([["a"]], { header: false, caption: "A [#]" });
    expect(typst).toContain("caption: [A \\[\\#\\]],");
  });
});
