import { describe, expect, it } from "vitest";
import { formatColumnWidth, parseColumnSpec, serializeColumnSpec, widthArgument } from "./column-spec";

describe("column specification parsing", () => {
  it("reads alignments and vertical borders", () => {
    const columns = parseColumnSpec("|l|c r|");
    expect(columns.map((column) => column.alignment)).toEqual(["left", "center", "right"]);
    expect(columns.map((column) => [column.borderLeft, column.borderRight])).toEqual([
      [1, 1],
      [0, 0],
      [0, 1],
    ]);
  });

  it("reads paragraph columns with absolute, relative and custom widths", () => {
    const columns = parseColumnSpec("p{2cm}m{0.5\\linewidth}b{\\mywidth}");
    expect(columns.every((column) => column.paragraph)).toBe(true);
    expect(columns[0].width).toEqual({ kind: "absolute", value: 2, unit: "cm" });
    expect(columns[1].width).toEqual({ kind: "relative", fraction: 0.5, command: "linewidth" });
    expect(columns[2].width).toEqual({ kind: "custom", raw: "\\mywidth" });
    expect(formatColumnWidth(columns[1].width!)).toBe("50%");
    expect(widthArgument(columns[1].width!)).toBe("0.5\\linewidth");
  });

  it("derives the alignment of a paragraph column from its prefix", () => {
    const [column] = parseColumnSpec(">{\\centering\\arraybackslash}p{3cm}");
    expect(column.alignment).toBe("center");
    expect(column.prefix).toBe(">{\\centering\\arraybackslash}");
    expect(column.content).toBe("p{3cm}");
  });

  it("keeps cell spacing on the neighbouring column", () => {
    const columns = parseColumnSpec("@{}l@{\\hspace{1em}}r@{}");
    expect(columns[0].spacingLeft).toBe("@{}");
    expect(columns[0].spacingRight).toBe("@{\\hspace{1em}}");
    expect(columns[1].spacingRight).toBe("@{}");
  });

  it("treats X columns as stretching paragraph columns", () => {
    const columns = parseColumnSpec("lX");
    expect(columns[1].paragraph).toBe(true);
    expect(columns[1].content).toBe("X");
    expect(columns[1].width).toBeUndefined();
  });

  it("round-trips through the serializer", () => {
    const spec = "|>{\\raggedleft\\arraybackslash}p{2cm}|c@{}|r||";
    expect(serializeColumnSpec(parseColumnSpec(spec))).toBe(spec);
  });

  it("rejects specifiers the grid cannot represent", () => {
    expect(() => parseColumnSpec("*{3}{c}")).toThrow();
    expect(() => parseColumnSpec("l>{\\bfseries}")).toThrow();
    expect(() => parseColumnSpec("p{2cm")).toThrow();
  });
});
