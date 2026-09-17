import { describe, expect, it } from "vitest";
import { isDisplayMathSource, mathNodeJSON, mathRenderInput, splitMathSource } from "./source";

describe("splitMathSource", () => {
  it.each([
    ["$x$", { open: "$", close: "$", display: false, environment: null, body: "x" }],
    ["$$x$$", { open: "$$", close: "$$", display: true, environment: null, body: "x" }],
    [String.raw`$a\$b$`, { open: "$", close: "$", display: false, environment: null, body: String.raw`a\$b` }],
    [String.raw`\(x\)`, { open: String.raw`\(`, close: String.raw`\)`, display: false, environment: null, body: "x" }],
    [String.raw`\[x\]`, { open: String.raw`\[`, close: String.raw`\]`, display: true, environment: null, body: "x" }],
    [
      "\\begin{align}\na &= b\n\\end{align}",
      { open: "\\begin{align}", close: "\\end{align}", display: true, environment: "align", body: "\na &= b\n" },
    ],
    [
      "\\begin{equation*}x\\end{equation*}",
      { open: "\\begin{equation*}", close: "\\end{equation*}", display: true, environment: "equation*", body: "x" },
    ],
  ])("splits %s", (source, expected) => {
    expect(splitMathSource(source)).toEqual(expected);
  });

  it.each([
    "",
    " $x$",
    "$x$ ",
    "$$",
    "$",
    "$$$",
    "$x$y$",
    "$a$$b$",
    "$$a$$b$$",
    String.raw`$\$`,
    String.raw`\(x`,
    "\\begin{alignat}x\\end{alignat}",
    "\\begin{align}x\\end{equation}",
    "text",
  ])("rejects %j", (source) => {
    expect(splitMathSource(source)).toBeNull();
  });
});

describe("isDisplayMathSource", () => {
  it("reports display delimiters and environments", () => {
    expect(isDisplayMathSource("$$x$$")).toBe(true);
    expect(isDisplayMathSource(String.raw`\[x\]`)).toBe(true);
    expect(isDisplayMathSource("\\begin{gather*}x\\end{gather*}")).toBe(true);
    expect(isDisplayMathSource("$x$")).toBe(false);
    expect(isDisplayMathSource("plain")).toBe(false);
  });
});

describe("mathRenderInput", () => {
  it("passes delimited math through as its body", () => {
    expect(mathRenderInput("$x$")).toEqual({ body: "x", display: false });
    expect(mathRenderInput(String.raw`\[y\]`)).toEqual({ body: "y", display: true });
  });

  it("keeps environments KaTeX understands intact", () => {
    expect(mathRenderInput("\\begin{align}a\\end{align}")).toEqual({
      body: "\\begin{align}a\\end{align}",
      display: true,
    });
  });

  it("maps environments KaTeX lacks onto supported ones", () => {
    expect(mathRenderInput("\\begin{multline}a\\\\b\\end{multline}")).toEqual({
      body: "\\begin{gathered}a\\\\b\\end{gathered}",
      display: true,
    });
    expect(mathRenderInput("\\begin{eqnarray*}a&=&b\\end{eqnarray*}")).toEqual({
      body: "\\begin{array}{rcl}a&=&b\\end{array}",
      display: true,
    });
    expect(mathRenderInput("\\begin{displaymath}z\\end{displaymath}")).toEqual({ body: "z", display: true });
  });

  it("strips labels that KaTeX cannot render", () => {
    expect(mathRenderInput("\\begin{equation}\\label{eq:1}x\\end{equation}")).toEqual({
      body: "\\begin{equation}x\\end{equation}",
      display: true,
    });
  });

  it("returns null for sources that are not math", () => {
    expect(mathRenderInput("plain")).toBeNull();
  });
});

describe("mathNodeJSON", () => {
  it("builds the node the source belongs in", () => {
    expect(mathNodeJSON("$x$")).toEqual({ type: "mathInline", attrs: { source: "$x$" } });
    expect(mathNodeJSON("\\[y\\]")).toEqual({ type: "mathDisplay", attrs: { source: "\\[y\\]" } });
    expect(mathNodeJSON("plain")).toBeNull();
  });
});
