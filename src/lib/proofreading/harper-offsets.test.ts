import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Dialect, LocalLinter } from "harper.js";
import { binaryInlined as binary } from "harper.js/binaryInlined";
import {
  intersectsMaskedRegion,
  maskLatexForProseRegions,
} from "@oleafly/editor";

describe("Harper span offsets", () => {
  let linter: LocalLinter;

  beforeAll(async () => {
    linter = new LocalLinter({ binary });
    await linter.setup();
    await linter.setDialect(Dialect.American);
    await linter.clearWords();
    await linter.importWords(["Dummy"]);
  });

  afterAll(async () => {
    await linter.dispose();
  });

  it("reports UTF-16 code units, so an emoji does not shift a span", async () => {
    const text =
      "Progress 🙂🚀 shows the the pair and a Qwertzuiopz word.";
    expect(text.length).toBeGreaterThan([...text].length);
    const lints = await linter.lint(text, { language: "plaintext" });
    const spans = lints.map((lint) => {
      const span = lint.span();
      const slice = text.slice(span.start, span.end);
      span.free();
      lint.free();
      return slice;
    });
    expect(spans).toContain("the the");
    expect(spans).toContain("Qwertzuiopz");
  });

  it("lands a LaTeX finding on the document text after an emoji", async () => {
    const source = String.raw`\section{Progress 🙂}
We compare the the results in \cite{smith2020} today.`;
    const { prose, masked } = maskLatexForProseRegions(source);
    expect(prose).toHaveLength(source.length);
    const lints = await linter.lint(prose, { language: "plaintext" });
    const kept: string[] = [];
    for (const lint of lints) {
      const span = lint.span();
      if (!intersectsMaskedRegion(masked, span.start, span.end)) {
        kept.push(source.slice(span.start, span.end));
      }
      span.free();
      lint.free();
    }
    expect(kept).toContain("the the");
    expect(kept.join(" ")).not.toContain("smith2020");
  });

  it("drops a repeated-word finding that spans a masked equation", async () => {
    const source = "We add and \\(c+d\\) and then stop.";
    const { prose, masked } = maskLatexForProseRegions(source);
    const lints = await linter.lint(prose, { language: "plaintext" });
    const kept: string[] = [];
    for (const lint of lints) {
      const span = lint.span();
      if (!intersectsMaskedRegion(masked, span.start, span.end)) {
        kept.push(`${lint.lint_kind()}:${source.slice(span.start, span.end)}`);
      }
      span.free();
      lint.free();
    }
    expect(kept.some((entry) => entry.startsWith("Repetition"))).toBe(
      false,
    );
  });
});
