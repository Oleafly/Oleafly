import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { scanMathExpressions } from "./math-source";

describe("scanMathExpressions", () => {
  it("keeps fenced and escaped Markdown out of math results", () => {
    const source = "Before \\$x and `$y$`\n\n```text\n$z$\n```\n\nAfter $a$.";

    expect(scanMathExpressions(source, { format: "markdown" })).toMatchObject([
      { body: "a", delimiter: "$", status: "complete" },
    ]);
  });

  it("scans a frame-sized plain streaming tail without quadratic line-prefix work", () => {
    const source = "A long prose line without math. ".repeat(800);
    scanMathExpressions(source, { format: "markdown" });
    const startedAt = performance.now();
    for (let iteration = 0; iteration < 20; iteration++) {
      scanMathExpressions(source, { format: "markdown" });
    }

    expect(performance.now() - startedAt).toBeLessThan(750);
  });
});

describe("scanMathExpressions for Typst", () => {
  const typst = (source: string) =>
    scanMathExpressions(source, { format: "typst" }).map((expression) => ({
      source: expression.source,
      body: expression.body,
      display: expression.display,
      status: expression.status,
    }));

  it("tells inline from display math by the inner whitespace", () => {
    expect(typst("Area $pi r^2$ and $ a + b $ and $x $.")).toEqual([
      { source: "$pi r^2$", body: "pi r^2", display: false, status: "complete" },
      { source: "$ a + b $", body: " a + b ", display: true, status: "complete" },
      { source: "$x $", body: "x ", display: false, status: "complete" },
    ]);
  });

  it("keeps a multi-line display equation whole", () => {
    expect(typst("$\n  a &= b \\\n  &= c\n$")).toMatchObject([{ display: true, status: "complete" }]);
  });

  it("ignores dollars in raw text, comments, code strings and escapes", () => {
    const source = [
      "`raw $a$` and ```$b$```",
      "// line $c$",
      "/* block /* nested $d$ */ $e$ */",
      String.raw`price \$5 and #f("$g$") and #let s = "$h$"`,
      "real $k$",
    ].join("\n");
    expect(typst(source).map((expression) => expression.source)).toEqual(["$k$"]);
  });

  it("treats quotes in markup as smart quotes and strings inside math as strings", () => {
    expect(typst(`"quoted $x$" and $"a $ b" + y$`).map((expression) => expression.source)).toEqual([
      "$x$",
      `$"a $ b" + y$`,
    ]);
  });

  it("does not read a URL as a comment", () => {
    expect(typst("see https://example.com/page and $z$").map((expression) => expression.source)).toEqual(["$z$"]);
  });

  it("marks an unclosed equation as incomplete at the end of its line", () => {
    expect(typst("text $x + y\nmore")).toEqual([
      { source: "$x + y", body: "x + y", display: false, status: "incomplete" },
    ]);
  });

  it("keeps offsets relative to the full text when scanning a range", () => {
    const source = "aa $x$ bb $y$";
    const [expression] = scanMathExpressions(source, { format: "typst", from: 7 });
    expect(source.slice(expression.from, expression.to)).toBe("$y$");
  });
});
