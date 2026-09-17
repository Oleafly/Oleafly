import { describe, expect, it } from "vitest";
import { columnsToTableSpec, normalizeTableColumns, tableSpecToColumns } from "./table-spec";

describe("tableSpecToColumns", () => {
  it("parses alignments, widths and borders", () => {
    expect(tableSpecToColumns("|l|c r|p{3cm}|")).toEqual([
      { align: "l", width: null, borderLeft: true, borderRight: true },
      { align: "c", width: null, borderLeft: false, borderRight: false },
      { align: "r", width: null, borderLeft: false, borderRight: true },
      { align: "p", width: "3cm", borderLeft: false, borderRight: true },
    ]);
  });

  it("supports m and b paragraph columns with nested braces in the width", () => {
    expect(tableSpecToColumns("m{2cm}b{\\dimexpr\\textwidth-1cm}")).toEqual([
      { align: "m", width: "2cm", borderLeft: false, borderRight: false },
      { align: "b", width: "\\dimexpr\\textwidth-1cm", borderLeft: false, borderRight: false },
    ]);
  });

  it.each(["||l", "l||c", "X", "S", "@{}l", "p", "p{3cm", "", "|", "*{3}{c}", ">{\\bf}l"])(
    "rejects %j",
    (spec) => {
      expect(tableSpecToColumns(spec)).toBeNull();
    },
  );
});

describe("columnsToTableSpec", () => {
  it("round-trips a parsed specification", () => {
    for (const spec of ["|l|c|r|", "lcr", "p{3cm}c", "|p{2em}|", "l|c"]) {
      const columns = tableSpecToColumns(spec);
      expect(columns).not.toBeNull();
      expect(columnsToTableSpec(columns ?? [])).toBe(spec);
    }
  });

  it("drops whitespace", () => {
    expect(columnsToTableSpec(tableSpecToColumns("l c r") ?? [])).toBe("lcr");
  });
});

describe("normalizeTableColumns", () => {
  it("drops malformed entries and coerces flags", () => {
    expect(
      normalizeTableColumns([
        { align: "c", width: 3, borderLeft: "yes", borderRight: true },
        { align: "X" },
        null,
        "l",
      ]),
    ).toEqual([{ align: "c", width: null, borderLeft: false, borderRight: true }]);
    expect(normalizeTableColumns("lcr")).toEqual([]);
  });
});
