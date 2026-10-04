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

function sources(source: string, format: "latex" | "markdown" | "typst", options: { from?: number; to?: number; excluded?: { from: number; to: number }[] } = {}) {
  return scanMathExpressions(source, { format, ...options }).map((expression) =>
    expression.status === "complete" ? expression.source : `${expression.source}…`,
  );
}

describe("scanMathExpressions for Markdown", () => {
  it("recognises every delimiter and marks display math", () => {
    const found = scanMathExpressions("$a$ $$b$$ \\(c\\) \\[d\\]", { format: "markdown" });
    expect(found.map((expression) => [expression.body, expression.delimiter, expression.display])).toEqual([
      ["a", "$", false],
      ["b", "$$", true],
      ["c", "\\(", false],
      ["d", "\\[", true],
    ]);
  });

  it("treats unmatched currency as text but keeps a complete number expression", () => {
    expect(sources("the $20$ case", "markdown")).toEqual(["$20$"]);
    expect(sources("pay $20 now", "markdown")).toEqual([]);
  });

  it("requires a dollar to touch its content on both sides", () => {
    expect(sources("a $ b$ and $c $ d", "markdown")).toEqual(["$c $ d…"]);
    expect(sources("$a$1 then $b$", "markdown")).toEqual(["$a$1 then $b$"]);
  });

  it("stops an unclosed expression at the end of its line", () => {
    expect(sources("start $x + y\nnext", "markdown")).toEqual(["$x + y…"]);
    expect(sources("$$ open\n$$", "markdown")).toEqual(["$$ open\n$$"]);
    expect(sources("tail $$x", "markdown")).toEqual(["$$x…"]);
  });

  it("skips tilde fences, longer closing fences and unclosed fences", () => {
    expect(sources("~~~\n$a$\n~~~~\n$b$", "markdown")).toEqual(["$b$"]);
    expect(sources("```\n$a$\n~~~\n$b$\n```\n$c$", "markdown")).toEqual(["$c$"]);
    expect(sources("```\n$a$", "markdown")).toEqual([]);
    expect(sources("```", "markdown")).toEqual([]);
    expect(sources("    ```\n$a$", "markdown")).toEqual(["$a$"]);
  });

  it("skips inline code including unterminated runs", () => {
    expect(sources("``code $a$`` then $b$", "markdown")).toEqual(["$b$"]);
    expect(sources("`open $a$\n$b$", "markdown")).toEqual(["$b$"]);
    expect(sources("`open $a$", "markdown")).toEqual([]);
  });

  it("skips link destinations, HTML tags, comments and bare URLs", () => {
    expect(sources("[x](http://a/$b$(c)\\)d) $e$", "markdown")).toEqual(["$e$"]);
    expect(sources("[x](a $b$\n$c$", "markdown")).toEqual(["$c$"]);
    expect(sources("[x](unclosed $b$", "markdown")).toEqual([]);
    expect(sources("<span title=\"$a$\"> $b$", "markdown")).toEqual(["$b$"]);
    expect(sources("a < b $c$ and <x\n$d$>", "markdown")).toEqual(["$c$", "$d$"]);
    expect(sources("<!-- $a$ --> $b$ <!-- $c$", "markdown")).toEqual(["$b$"]);
    expect(sources("see https://x.org/$a$ and www.y.org/$b$ and hello $c$", "markdown")).toEqual(["$c$"]);
  });

  it("respects excluded ranges and the scan window", () => {
    const source = "$a$ $b$ $c$";
    expect(sources(source, "markdown", { excluded: [{ from: 4, to: 7 }, { from: 0, to: 1 }] })).toEqual(["$c$"]);
    expect(sources(source, "markdown", { from: 4, to: 7 })).toEqual(["$b$"]);
    expect(sources(source, "markdown", { from: 3, excluded: [{ from: 50, to: 60 }, { from: 0, to: 2 }] })).toEqual([
      "$b$",
      "$c$",
    ]);
    expect(sources("$a + b$", "markdown", { excluded: [{ from: 6, to: 7 }] })).toEqual(["$a + b$…"]);
  });
});

describe("scanMathExpressions for LaTeX", () => {
  it("skips comments but not escaped percent signs", () => {
    expect(sources("% $a$\n$b$ \\% $c$", "latex")).toEqual(["$b$", "$c$"]);
    expect(sources("text % $a$", "latex")).toEqual([]);
  });

  it("does not close math inside a comment", () => {
    expect(sources("$a % $\nb$", "latex")).toEqual(["$a % $\nb$"]);
  });

  it("skips verbatim commands and environments", () => {
    expect(sources("\\verb|$a$| \\verb*+$b$+ $c$", "latex")).toEqual(["$c$"]);
    expect(sources("\\verb $a$", "latex")).toEqual(["$a$"]);
    expect(sources("\\verb", "latex")).toEqual([]);
    expect(sources("\\verb|$a$", "latex")).toEqual([]);
    expect(sources("\\\\verb|$a$|", "latex")).toEqual(["$a$"]);
    expect(sources("\\begin{lstlisting}$a$\\end{lstlisting}$b$", "latex")).toEqual(["$b$"]);
    expect(sources("\\begin{verbatim*}\n$a$", "latex")).toEqual([]);
    expect(sources("\\\\begin{verbatim}$a$", "latex")).toEqual(["$a$"]);
  });

  it("ignores escaped delimiters and doubled dollars", () => {
    expect(sources("\\$a\\$ \\\\(b\\) $$c$$ $$$d", "latex")).toEqual(["$$c$$"]);
    expect(sources("$$a$$$ b", "latex")).toEqual(["$$a$$$ b…"]);
  });
});

describe("scanMathExpressions for Typst edge cases", () => {
  it("handles empty and unterminated raw text", () => {
    expect(sources("`` $a$", "typst")).toEqual(["$a$"]);
    expect(sources("```raw $a$", "typst")).toEqual([]);
  });

  it("handles escaped quotes and unterminated strings", () => {
    expect(sources('#f("a\\"$b$") $c$', "typst")).toEqual(["$c$"]);
    expect(sources('#f("open $b$\n$c$', "typst")).toEqual(["$c$"]);
    expect(sources('#f("open $b$', "typst")).toEqual([]);
  });

  it("skips excluded ranges", () => {
    expect(sources("$a$ $b$", "typst", { excluded: [{ from: 0, to: 3 }] })).toEqual(["$b$"]);
  });
});
