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
