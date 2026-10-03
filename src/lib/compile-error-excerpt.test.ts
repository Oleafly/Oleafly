import { describe, expect, it } from "vitest";
import type { CompileError } from "@/lib/tauri";
import { compileErrorExcerpt, formatCompileErrorDetails, formatCompileErrorExcerpt } from "./compile-error-excerpt";

function error(overrides: Partial<CompileError>): CompileError {
  return {
    line: 3,
    file: "main.typ",
    message: "unknown variable: foo",
    kind: "error",
    explanation: null,
    column: 8,
    end_column: 11,
    source_line: "Hello #foo world.",
    ...overrides,
  };
}

describe("compileErrorExcerpt", () => {
  it("splits the source line around the reported span", () => {
    expect(compileErrorExcerpt(error({}))).toEqual({
      line: 3,
      before: "Hello #",
      span: "foo",
      after: " world.",
      clippedStart: false,
      clippedEnd: false,
    });
  });

  it("marks one character when the span has no end", () => {
    expect(compileErrorExcerpt(error({ end_column: null, column: 3, source_line: "#f(1, 2" }))?.span).toBe("(");
    expect(compileErrorExcerpt(error({ end_column: undefined, column: 1, source_line: "😀 x" }))?.span).toBe("😀");
  });

  it("widens a clipped excerpt instead of splitting a surrogate pair", () => {
    const line = `😀${"b".repeat(59)}E${"c".repeat(59)}😀tail`;
    const excerpt = compileErrorExcerpt(error({ column: 62, end_column: 63, source_line: line }));
    expect(excerpt).toMatchObject({ span: "E", clippedStart: false, clippedEnd: true });
    expect(excerpt?.before).toBe(`😀${"b".repeat(59)}`);
    expect(excerpt?.after).toBe(`${"c".repeat(59)}😀`);
    const plain = compileErrorExcerpt(error({ column: 63, end_column: 64, source_line: `x${line}` }));
    expect(plain).toMatchObject({ clippedStart: true, clippedEnd: true });
    expect(plain?.before).toBe(`😀${"b".repeat(59)}`);
  });

  it("has nothing to show without a source line or a column", () => {
    expect(compileErrorExcerpt(error({ source_line: null }))).toBeNull();
    expect(compileErrorExcerpt(error({ column: null }))).toBeNull();
    expect(compileErrorExcerpt(error({ line: null }))).toBeNull();
    expect(
      compileErrorExcerpt({ line: 2, file: "main.tex", message: "Undefined control sequence.", kind: "error", explanation: null }),
    ).toBeNull();
  });

  it("keeps a window around the span on very long lines", () => {
    const before = "a".repeat(300);
    const after = "b".repeat(300);
    const excerpt = compileErrorExcerpt(
      error({ source_line: `${before}#foo${after}`, column: 302, end_column: 305 }),
    );
    expect(excerpt?.span).toBe("foo");
    expect(excerpt?.clippedStart).toBe(true);
    expect(excerpt?.clippedEnd).toBe(true);
    expect((excerpt?.before.length ?? 0) + (excerpt?.after.length ?? 0)).toBeLessThan(200);
    if (!excerpt) throw new Error("expected an excerpt");
    expect(formatCompileErrorExcerpt(excerpt).split("\n")[0]).toMatch(/^3 \| …a+#foob+…$/);
  });

  it("clamps a stale column to the line", () => {
    expect(compileErrorExcerpt(error({ column: 90, end_column: 95 }))?.span).toBe("");
  });
});

describe("formatCompileErrorDetails", () => {
  it("prints the excerpt with a caret line and the hints", () => {
    expect(
      formatCompileErrorDetails(error({ hints: ["try adding spaces: `f o o`"] }), "Hint"),
    ).toBe("3 | Hello #foo world.\n  |        ^^^\nHint: try adding spaces: `f o o`");
  });

  it("keeps tabs in the caret line so the caret lines up", () => {
    expect(
      formatCompileErrorDetails(error({ source_line: "\tx #foo", column: 5, end_column: 8, line: 12 }), "Hint"),
    ).toBe("12 | \tx #foo\n   | \t   ^^^");
  });

  it("is empty for an error without an excerpt or hints", () => {
    expect(formatCompileErrorDetails(error({ source_line: null }), "Hint")).toBe("");
  });
});
