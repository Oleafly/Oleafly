import { describe, expect, it } from "vitest";
import { reconstructPdfPageText } from "./pdf-text";

function run(
  str: string,
  x: number,
  y: number,
  width: number,
  hasEOL = false,
  height = 10,
) {
  return {
    str,
    transform: [1, 0, 0, height, x, y],
    width,
    height,
    hasEOL,
    dir: "ltr",
    fontName: "F1",
  };
}

describe("reconstructPdfPageText", () => {
  it("honors explicit hasEOL boundaries even when geometry stays level", () => {
    const page = reconstructPdfPageText([
      run("GitHub Projects", 72, 700, 100, true),
      run("Compiler", 72, 700, 45),
    ]);
    expect(page.text).toBe("GitHub Projects\nCompiler");
  });

  it("removes horizontal padding before line breaks in linear time", () => {
    const page = reconstructPdfPageText([
      run(`First${" ".repeat(20_000)}`, 72, 700, 100, true),
      run("Second", 72, 680, 45),
    ]);
    expect(page.text).toBe("First\nSecond");
  });

  it("infers a word separator from a visible same-line geometry gap", () => {
    const page = reconstructPdfPageText([
      run("GitHub", 72, 700, 42),
      run("Projects", 120, 700, 48),
    ]);
    expect(page.text).toBe("GitHub Projects");
  });

  it("does not split adjacent runs from the same word", () => {
    const page = reconstructPdfPageText([
      run("Git", 72, 700, 18),
      run("Hub", 90.2, 700, 20),
    ]);
    expect(page.text).toBe("GitHub");
  });

  it("infers a line break from geometry when hasEOL is absent", () => {
    const page = reconstructPdfPageText([
      run("Experience", 72, 700, 60),
      run("Acme", 72, 680, 30),
    ]);
    expect(page.text).toBe("Experience\nAcme");
  });

  it("preserves content-stream order instead of sorting columns by coordinates", () => {
    const page = reconstructPdfPageText([
      run("right", 300, 700, 30),
      run("left", 72, 700, 24),
    ]);
    expect(page.text).toBe("rightleft");
    expect(page.items.map((item) => item.str)).toEqual(["right", "left"]);
  });

  it("ignores marked-content records without unsafe casts", () => {
    const page = reconstructPdfPageText([
      { type: "beginMarkedContent", id: "mc0" },
      run("Selectable text", 72, 700, 80),
      { type: "endMarkedContent", id: "mc0" },
    ]);
    expect(page.text).toBe("Selectable text");
    expect(page.items).toHaveLength(1);
  });
});
