import { describe, expect, it } from "vitest";
import {
  enclosingMathEnvironment,
  MATH_ENVIRONMENTS,
} from "./hover-math";

describe("MATH_ENVIRONMENTS", () => {
  it("contains the standard display math environments", () => {
    for (const env of [
      "equation",
      "align",
      "gather",
      "multline",
      "eqnarray",
      "alignat",
      "flalign",
      "math",
      "displaymath",
    ]) {
      expect(MATH_ENVIRONMENTS.has(env)).toBe(true);
    }
    expect(MATH_ENVIRONMENTS.has("itemize")).toBe(false);
  });
});

describe("enclosingMathEnvironment", () => {
  it("finds an equation environment with the correct body", () => {
    const text = "Intro text.\n\\begin{equation}\n  E = mc^2\n\\end{equation}\nAfter.";
    const offset = text.indexOf("mc^2");
    expect(enclosingMathEnvironment(text, offset)).toEqual({
      body: "\n  E = mc^2\n",
      environment: "equation",
    });
  });

  it("finds a starred align* environment and keeps the star", () => {
    const text = "\\begin{align*}a &= b \\\\ c &= d\\end{align*}";
    const offset = text.indexOf("c &= d");
    expect(enclosingMathEnvironment(text, offset)).toEqual({
      body: "a &= b \\\\ c &= d",
      environment: "align*",
    });
  });

  it("finds a gather environment", () => {
    const text = "before \\begin{gather}x + y = z\\end{gather} after";
    const offset = text.indexOf("y = z");
    expect(enclosingMathEnvironment(text, offset)).toEqual({
      body: "x + y = z",
      environment: "gather",
    });
  });

  it("resolves nested same-name environments to the innermost one", () => {
    const text =
      "\\begin{equation}OUTER1 \\begin{equation}INNER\\end{equation} OUTER2\\end{equation}";
    const inner = enclosingMathEnvironment(text, text.indexOf("INNER") + 2);
    expect(inner).toEqual({ body: "INNER", environment: "equation" });

    const outer = enclosingMathEnvironment(text, text.indexOf("OUTER2"));
    expect(outer).toEqual({
      body: "OUTER1 \\begin{equation}INNER\\end{equation} OUTER2",
      environment: "equation",
    });
  });

  it("returns null when the offset is outside any math", () => {
    const text = "Plain prose \\begin{equation}x\\end{equation} more prose";
    expect(enclosingMathEnvironment(text, 3)).toBeNull();
    expect(enclosingMathEnvironment(text, text.length - 2)).toBeNull();
  });

  it("ignores non-math environments", () => {
    const text = "\\begin{itemize}\\item hello\\end{itemize}";
    expect(enclosingMathEnvironment(text, text.indexOf("hello"))).toBeNull();
  });

  it("does not see a \\begin that lies beyond the backward radius", () => {
    const text = `\\begin{equation}${"x".repeat(200)}\\end{equation}`;
    const offset = text.indexOf("\\end") - 5;
    expect(enclosingMathEnvironment(text, offset, 50)).toBeNull();
    // Sanity: with a large enough radius the same offset resolves.
    expect(enclosingMathEnvironment(text, offset, 4096)).not.toBeNull();
  });

  it("does not match an \\end that lies beyond the forward radius", () => {
    const text = `\\begin{equation}${"x".repeat(200)}\\end{equation}`;
    const offset = text.indexOf("xxx");
    expect(enclosingMathEnvironment(text, offset, 50)).toBeNull();
    expect(enclosingMathEnvironment(text, offset, 4096)).not.toBeNull();
  });

  it("falls back to \\[ ... \\] display math when the offset is inside", () => {
    const text = "before \\[ x^2 + y^2 \\] after";
    const offset = text.indexOf("y^2");
    expect(enclosingMathEnvironment(text, offset)).toEqual({
      body: " x^2 + y^2 ",
      environment: "display",
    });
  });

  it("returns null for display math that the offset is not inside", () => {
    const text = "before \\[ x^2 \\] after";
    expect(enclosingMathEnvironment(text, 2)).toBeNull();
    expect(enclosingMathEnvironment(text, text.length - 1)).toBeNull();
  });

  it("handles display-math window arithmetic with a small radius", () => {
    const padding = "p".repeat(300);
    const text = `${padding}\\[ a+b \\]${padding}`;
    const inside = text.indexOf("a+b") + 1;
    expect(enclosingMathEnvironment(text, inside, 64)).toEqual({
      body: " a+b ",
      environment: "display",
    });
    // The expression's opener lies before the window, so it cannot be seen.
    const farAfter = text.length - 10;
    expect(enclosingMathEnvironment(text, farAfter, 64)).toBeNull();
  });

  it("does not treat inline $...$ math as a display preview target", () => {
    const text = "some $x + y$ inline";
    expect(enclosingMathEnvironment(text, text.indexOf("x +"))).toBeNull();
  });

  it("returns null for an unbalanced \\begin{equation} without an end", () => {
    const text = "\\begin{equation} x = 1 and it never ends";
    expect(enclosingMathEnvironment(text, text.indexOf("x = 1"))).toBeNull();
  });

  it("never throws on garbage input or out-of-range offsets", () => {
    const garbage = "\\begin{\\end{}}}{{{ \\begin{align \\] $$ \\[ %%% \\\\begin{math}";
    for (const offset of [-10, 0, 5, garbage.length, garbage.length + 100, Number.NaN]) {
      expect(() => enclosingMathEnvironment(garbage, offset)).not.toThrow();
    }
    expect(() => enclosingMathEnvironment("", 0)).not.toThrow();
    expect(enclosingMathEnvironment("", 0)).toBeNull();
  });
});
