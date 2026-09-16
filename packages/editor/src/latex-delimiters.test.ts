import { describe, expect, it } from "vitest";
import {
  latexSnippetLiteral,
  latexDelimiterCloserAt,
  latexDelimiterClosing,
  latexDelimiterCompletionSpecs,
  latexDelimiterFamilySpecs,
  latexDelimiterGlyphForClosingTrigger,
  latexDelimiterGlyphForTrigger,
  latexDelimiterOpening,
  latexDelimiterPrefixBefore,
  latexEmptyDelimiterPairAt,
  latexMathCommandSpecs,
  LATEX_DELIMITER_GLYPHS,
  LATEX_DELIMITER_SIZES,
  type LatexDelimiterGlyph,
  type LatexDelimiterSize,
} from "./latex-delimiters";

function size(open: string): LatexDelimiterSize {
  const found = LATEX_DELIMITER_SIZES.find((entry) => entry.open === open);
  if (!found) throw new Error(`no size ${open}`);
  return found;
}

function glyph(open: string): LatexDelimiterGlyph {
  const found = LATEX_DELIMITER_GLYPHS.find((entry) => entry.open === open);
  if (!found) throw new Error(`no glyph ${open}`);
  return found;
}

function labels(): Set<string> {
  return new Set(latexDelimiterCompletionSpecs().map((spec) => spec.label));
}

describe("delimiter tables", () => {
  it("covers the auto-sized, fixed-size and separator families", () => {
    expect(LATEX_DELIMITER_SIZES.map((entry) => entry.open)).toEqual([
      "left",
      "bigl",
      "Bigl",
      "biggl",
      "Biggl",
      "big",
      "Big",
      "bigg",
      "Bigg",
    ]);
    expect(
      LATEX_DELIMITER_SIZES.filter((entry) => entry.middle).map(
        (entry) => entry.middle,
      ),
    ).toEqual(["middle", "bigm", "Bigm", "biggm", "Biggm"]);
  });

  it("gives every glyph a closer and every opener a unique spelling", () => {
    const opens = LATEX_DELIMITER_GLYPHS.map((entry) => entry.open);
    expect(new Set(opens).size).toBe(opens.length);
    for (const entry of LATEX_DELIMITER_GLYPHS) {
      expect(entry.open.length, entry.open).toBeGreaterThan(0);
      expect(entry.close.length, entry.open).toBeGreaterThan(0);
    }
  });

  it("carries the angle, floor, ceiling and norm delimiters", () => {
    const pairs = new Map(
      LATEX_DELIMITER_GLYPHS.map((entry) => [entry.open, entry.close]),
    );
    expect(pairs.get(String.raw`\langle`)).toBe(String.raw`\rangle`);
    expect(pairs.get(String.raw`\lvert`)).toBe(String.raw`\rvert`);
    expect(pairs.get(String.raw`\lVert`)).toBe(String.raw`\rVert`);
    expect(pairs.get(String.raw`\lfloor`)).toBe(String.raw`\rfloor`);
    expect(pairs.get(String.raw`\lceil`)).toBe(String.raw`\rceil`);
    expect(pairs.get(String.raw`\vert`)).toBe(String.raw`\vert`);
    expect(pairs.get(String.raw`\Vert`)).toBe(String.raw`\Vert`);
  });

  it("only marks a glyph standalone when its two halves differ", () => {
    for (const entry of LATEX_DELIMITER_GLYPHS) {
      if (!entry.standalone) continue;
      expect(entry.open, entry.open).not.toBe(entry.close);
    }
  });
});

describe("latexDelimiterPrefixBefore", () => {
  it("reads an opening size command", () => {
    const match = latexDelimiterPrefixBefore(String.raw`$x = \left`);
    expect(match?.role).toBe("open");
    expect(match?.command).toBe("left");
    expect(match?.escapedSlash).toBe(false);
    expect(match?.length).toBe(5);
  });

  it("separates a trailing backslash from the command", () => {
    const match = latexDelimiterPrefixBefore("\\left\\");
    expect(match?.command).toBe("left");
    expect(match?.escapedSlash).toBe(true);
    expect(match?.length).toBe(6);
  });

  it("classifies closers and separators by role", () => {
    expect(latexDelimiterPrefixBefore("\\right")?.role).toBe("close");
    expect(latexDelimiterPrefixBefore("\\bigr")?.role).toBe("close");
    expect(latexDelimiterPrefixBefore("\\middle")?.role).toBe("middle");
    expect(latexDelimiterPrefixBefore("\\Biggm")?.role).toBe("middle");
  });

  it("treats a symmetric fixed size as an opener", () => {
    expect(latexDelimiterPrefixBefore("\\big")?.role).toBe("open");
    expect(latexDelimiterPrefixBefore("\\Bigg")?.role).toBe("open");
  });

  it("rejects an escaped backslash, a longer word and bare text", () => {
    expect(latexDelimiterPrefixBefore("\\\\left")).toBeNull();
    expect(latexDelimiterPrefixBefore("\\lefty")).toBeNull();
    expect(latexDelimiterPrefixBefore("left")).toBeNull();
    expect(latexDelimiterPrefixBefore("")).toBeNull();
  });

  it("accepts a command after a doubled backslash that is itself escaped", () => {
    expect(latexDelimiterPrefixBefore("\\\\\\left")?.command).toBe("left");
  });
});

describe("trigger lookup", () => {
  it("maps bare trigger characters to their glyph", () => {
    expect(latexDelimiterGlyphForTrigger("(", false)?.close).toBe(")");
    expect(latexDelimiterGlyphForTrigger("[", false)?.close).toBe("]");
    expect(latexDelimiterGlyphForTrigger("<", false)?.close).toBe(">");
    expect(latexDelimiterGlyphForTrigger("|", false)?.close).toBe("|");
  });

  it("maps escaped trigger characters to the escaped glyph", () => {
    expect(latexDelimiterGlyphForTrigger("{", true)?.open).toBe(
      String.raw`\{`,
    );
    expect(latexDelimiterGlyphForTrigger("{", true)?.close).toBe(
      String.raw`\}`,
    );
    expect(latexDelimiterGlyphForTrigger("|", true)?.close).toBe(
      String.raw`\|`,
    );
  });

  it("refuses a brace with no backslash and a paren with one", () => {
    expect(latexDelimiterGlyphForTrigger("{", false)).toBeNull();
    expect(latexDelimiterGlyphForTrigger("(", true)).toBeNull();
  });

  it("maps a typed closing character back to its glyph", () => {
    expect(latexDelimiterGlyphForClosingTrigger(")")?.open).toBe("(");
    expect(latexDelimiterGlyphForClosingTrigger("]")?.open).toBe("[");
    expect(latexDelimiterGlyphForClosingTrigger(">")?.open).toBe("<");
    expect(latexDelimiterGlyphForClosingTrigger("|")?.open).toBe("|");
    expect(latexDelimiterGlyphForClosingTrigger("}")).toBeNull();
  });
});

describe("latexDelimiterCloserAt", () => {
  it("measures the closer that follows the caret", () => {
    expect(latexDelimiterCloserAt("\\right) tail", glyph("("))).toBe(7);
    expect(latexDelimiterCloserAt("\\bigr]", glyph("["))).toBe(6);
    expect(latexDelimiterCloserAt("\\Biggr>", glyph("<"))).toBe(7);
  });

  it("does not let a short size command match a longer one", () => {
    expect(latexDelimiterCloserAt("\\biggr)", glyph("("))).toBe(7);
    expect(latexDelimiterCloserAt("\\bigg)", glyph("("))).toBe(6);
    expect(latexDelimiterCloserAt("\\big)", glyph("("))).toBe(5);
  });

  it("returns null when the glyph does not match the closer", () => {
    expect(latexDelimiterCloserAt("\\right]", glyph("("))).toBeNull();
    expect(latexDelimiterCloserAt("plain text", glyph("("))).toBeNull();
  });
});

describe("latexEmptyDelimiterPairAt", () => {
  it("measures an empty sized pair", () => {
    expect(latexEmptyDelimiterPairAt("\\left(", "\\right)")).toEqual({
      open: 6,
      close: 7,
    });
    expect(
      latexEmptyDelimiterPairAt("x \\Biggl\\langle", "\\Biggr\\rangle y"),
    ).toEqual({ open: 13, close: 13 });
  });

  it("measures an empty standalone pair", () => {
    expect(latexEmptyDelimiterPairAt("\\langle", "\\rangle")).toEqual({
      open: 7,
      close: 7,
    });
  });

  it("ignores an escaped opener and a mismatched closer", () => {
    expect(latexEmptyDelimiterPairAt("\\\\left(", "\\right)")).toBeNull();
    expect(latexEmptyDelimiterPairAt("\\left(", "\\right]")).toBeNull();
    expect(latexEmptyDelimiterPairAt("\\left(", "x\\right)")).toBeNull();
  });

  it("ignores a pair whose halves come from different size families", () => {
    expect(latexEmptyDelimiterPairAt("\\bigl(", "\\Bigr)")).toBeNull();
  });
});

describe("delimiter completion specs", () => {
  it("offers every requested auto-sized form", () => {
    const all = labels();
    for (const label of [
      String.raw`\left(`,
      String.raw`\left[`,
      String.raw`\left\{`,
      String.raw`\left<`,
      String.raw`\left|`,
      String.raw`\left\|`,
      String.raw`\left\langle`,
      String.raw`\left\lvert`,
      String.raw`\left\lVert`,
      String.raw`\left\vert`,
      String.raw`\left\Vert`,
      String.raw`\left.`,
      String.raw`\right.`,
    ]) {
      expect(all.has(label), label).toBe(true);
    }
  });

  it("offers every requested fixed-size form", () => {
    const all = labels();
    for (const label of [
      String.raw`\bigl(`,
      String.raw`\bigr)`,
      String.raw`\Bigl[`,
      String.raw`\Bigr]`,
      String.raw`\biggl\{`,
      String.raw`\biggr\}`,
      String.raw`\Biggl\langle`,
      String.raw`\Biggr\rangle`,
      String.raw`\bigl\lvert`,
      String.raw`\Bigl\lVert`,
      String.raw`\big(`,
      String.raw`\Bigg\|`,
    ]) {
      expect(all.has(label), label).toBe(true);
    }
  });

  it("offers the standalone semantic pairs", () => {
    const all = labels();
    expect(all.has(String.raw`\langle`)).toBe(true);
    expect(all.has(String.raw`\rangle`)).toBe(true);
    expect(all.has(String.raw`\lvert`)).toBe(true);
    expect(all.has(String.raw`\lVert`)).toBe(true);
  });

  it("offers separators without a closing partner", () => {
    const specs = latexDelimiterCompletionSpecs();
    for (const label of [
      String.raw`\middle|`,
      String.raw`\middle\vert`,
      String.raw`\bigm|`,
      String.raw`\Biggm\Vert`,
    ]) {
      const spec = specs.find((entry) => entry.label === label);
      expect(spec, label).toBeDefined();
      expect(spec?.template, label).toBeNull();
    }
  });

  it("pairs a standalone opener but leaves its closer alone", () => {
    const specs = latexDelimiterCompletionSpecs();
    const open = specs.find((spec) => spec.label === String.raw`\langle`);
    const close = specs.find((spec) => spec.label === String.raw`\rangle`);
    expect(open?.template).toBe("\\langle${1}\\rangle");
    expect(close?.template).toBeNull();
  });

  it("wraps a tab stop between the two halves of every paired spec", () => {
    for (const spec of latexDelimiterCompletionSpecs()) {
      if (spec.template === null) continue;
      // Brace delimiters reach the snippet parser doubled, so compare against
      // the escaped spelling rather than the label shown in the dropdown.
      const escaped = spec.label.replace(/\\([{}])/gu, "\\\\$1");
      expect(spec.template.startsWith(escaped), spec.label).toBe(true);
      expect(spec.template, spec.label).toContain("${1}");
    }
  });

  it("doubles a brace delimiter so the snippet parser keeps it", () => {
    const brace = latexDelimiterCompletionSpecs().find(
      (spec) => spec.label === String.raw`\left\{`,
    );
    expect(brace?.template).toBe("\\left\\\\{${1}\\right\\\\}");
  });

  it("names every entry once", () => {
    const specs = latexDelimiterCompletionSpecs();
    expect(labels().size).toBe(specs.length);
  });

  it("never offers a closer as something that opens a pair", () => {
    for (const spec of latexDelimiterCompletionSpecs()) {
      if (!spec.label.startsWith("\\right")) continue;
      expect(spec.template, spec.label).toBeNull();
    }
  });
});

describe("latexDelimiterFamilySpecs", () => {
  it("scopes an opening family to openers of that size", () => {
    const specs = latexDelimiterFamilySpecs({
      size: size("left"),
      role: "open",
    });
    const found = specs.map((spec) => spec.label);
    expect(found).toContain(String.raw`\left\langle`);
    expect(found).toContain(String.raw`\left.`);
    expect(found).not.toContain(String.raw`\right\rangle`);
    expect(found.every((label) => label.startsWith("\\left"))).toBe(true);
  });

  it("scopes a closing family to closers of that size", () => {
    const found = latexDelimiterFamilySpecs({
      size: size("bigl"),
      role: "close",
    }).map((spec) => spec.label);
    expect(found).toContain(String.raw`\bigr\rangle`);
    expect(found).not.toContain(String.raw`\bigl\langle`);
  });

  it("scopes a separator family to bar-like glyphs", () => {
    const found = latexDelimiterFamilySpecs({
      size: size("left"),
      role: "middle",
    }).map((spec) => spec.label);
    expect(found).toContain(String.raw`\middle|`);
    expect(found).toContain(String.raw`\middle\Vert`);
    expect(found).not.toContain(String.raw`\middle(`);
    expect(found).not.toContain(String.raw`\middle\langle`);
  });

  it("gives a symmetric fixed size no separator forms", () => {
    expect(
      latexDelimiterFamilySpecs({ size: size("big"), role: "middle" }),
    ).toEqual([]);
  });

  it("builds openings and closings from the same two halves", () => {
    const entry = glyph(String.raw`\langle`);
    expect(latexDelimiterOpening(size("Biggl"), entry)).toBe(
      String.raw`\Biggl\langle`,
    );
    expect(latexDelimiterClosing(size("Biggl"), entry)).toBe(
      String.raw`\Biggr\rangle`,
    );
  });
});

describe("advanced math command specs", () => {
  it("covers the fraction, binomial and stacking families", () => {
    const found = new Set(
      latexMathCommandSpecs().map((spec) => spec.label),
    );
    for (const label of [
      "\\dfrac{}{}",
      "\\tfrac{}{}",
      "\\binom{}{}",
      "\\dbinom{}{}",
      "\\tbinom{}{}",
      "\\genfrac{}{}{}{}{}{}",
      "\\substack{}",
      "\\overset{}{}",
      "\\underset{}{}",
    ]) {
      expect(found.has(label), label).toBe(true);
    }
  });

  it("covers the definition commands", () => {
    const found = new Set(
      latexMathCommandSpecs().map((spec) => spec.label),
    );
    for (const label of [
      "\\DeclareMathOperator{}{}",
      "\\DeclarePairedDelimiter{}{}{}",
      "\\providecommand{}{}",
      "\\NewDocumentCommand{}{}{}",
      "\\DeclareDocumentCommand{}{}{}",
      "\\NewDocumentEnvironment{}{}{}{}",
    ]) {
      expect(found.has(label), label).toBe(true);
    }
  });

  it("writes single backslashes into placeholder defaults", () => {
    const operator = latexMathCommandSpecs().find(
      (spec) => spec.label === "\\DeclareMathOperator{}{}",
    );
    expect(operator?.template).toBe(
      "\\DeclareMathOperator{${1:\\cmd}}{${2:name}}",
    );
    const substack = latexMathCommandSpecs().find(
      (spec) => spec.label === "\\substack{}",
    );
    expect(substack?.template).toBe(
      "\\substack{${1:first} \\\\ ${2:second}}",
    );
  });

  it("names every entry once", () => {
    const specs = latexMathCommandSpecs();
    expect(new Set(specs.map((spec) => spec.label)).size).toBe(specs.length);
  });
});

describe("latexSnippetLiteral", () => {
  it("doubles a backslash that precedes a brace", () => {
    expect(latexSnippetLiteral("\\left\\{x\\right\\}")).toBe(
      "\\left\\\\{x\\right\\\\}",
    );
  });

  it("leaves group braces and tab stops alone", () => {
    expect(latexSnippetLiteral("\\frac{${1}}{${2}}")).toBe(
      "\\frac{${1}}{${2}}",
    );
  });

  it("leaves a LaTeX line break alone", () => {
    expect(latexSnippetLiteral("\\substack{a \\\\ b}")).toBe(
      "\\substack{a \\\\ b}",
    );
  });
});
