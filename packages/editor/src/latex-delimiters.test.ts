import { describe, expect, it } from "vitest";
import {
  LATEX_DELIMITER_COMPLETIONS,
  LATEX_DELIMITER_GLYPHS,
  LATEX_DELIMITER_SIZES,
  latexDelimiterCloserConsumption,
  latexDelimiterCloserFor,
  latexDelimiterCloserText,
  latexDelimiterClosesAhead,
  latexDelimiterClosing,
  latexDelimiterFamilySpecs,
  latexDelimiterGlyphForTrigger,
  latexDelimiterOpening,
  latexDelimiterPrefixBefore,
  latexDelimiterTakesPartner,
  latexDelimiterUnclosedInside,
  latexEmptyDelimiterPairAt,
  latexSnippetLiteral,
  type LatexDelimiterCloser,
  type LatexDelimiterCompletionSpec,
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

function spec(label: string): LatexDelimiterCompletionSpec {
  const found = LATEX_DELIMITER_COMPLETIONS.find(
    (entry) => entry.label === label,
  );
  if (!found) throw new Error(`no completion ${label}`);
  return found;
}

function labels(): Set<string> {
  return new Set(LATEX_DELIMITER_COMPLETIONS.map((entry) => entry.label));
}

const RIGHT_PAREN: LatexDelimiterCloser = { command: "right", glyph: ")" };
const RIGHT_BRACE: LatexDelimiterCloser = {
  command: "right",
  glyph: String.raw`\}`,
};
const RIGHT_BAR: LatexDelimiterCloser = { command: "right", glyph: "|" };
const RIGHT_NORM: LatexDelimiterCloser = {
  command: "right",
  glyph: String.raw`\|`,
};
const RIGHT_RANGLE: LatexDelimiterCloser = {
  command: "right",
  glyph: String.raw`\rangle`,
};
const BIG_PAREN: LatexDelimiterCloser = { command: "big", glyph: ")" };
const RANGLE: LatexDelimiterCloser = { command: "", glyph: String.raw`\rangle` };

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

  it("carries every delimiter the LaTeX kernel and amsmath declare", () => {
    const pairs = new Map(
      LATEX_DELIMITER_GLYPHS.map((entry) => [entry.open, entry.close]),
    );
    expect(pairs.get(String.raw`\langle`)).toBe(String.raw`\rangle`);
    expect(pairs.get(String.raw`\lvert`)).toBe(String.raw`\rvert`);
    expect(pairs.get(String.raw`\lVert`)).toBe(String.raw`\rVert`);
    expect(pairs.get(String.raw`\lfloor`)).toBe(String.raw`\rfloor`);
    expect(pairs.get(String.raw`\lceil`)).toBe(String.raw`\rceil`);
    expect(pairs.get(String.raw`\lbrace`)).toBe(String.raw`\rbrace`);
    expect(pairs.get(String.raw`\lgroup`)).toBe(String.raw`\rgroup`);
    expect(pairs.get(String.raw`\lmoustache`)).toBe(String.raw`\rmoustache`);
    expect(pairs.get(String.raw`\ulcorner`)).toBe(String.raw`\urcorner`);
    expect(pairs.get(String.raw`\llcorner`)).toBe(String.raw`\lrcorner`);
    for (const name of [
      String.raw`\vert`,
      String.raw`\Vert`,
      String.raw`\backslash`,
      String.raw`\uparrow`,
      String.raw`\downarrow`,
      String.raw`\updownarrow`,
      String.raw`\Uparrow`,
      String.raw`\Downarrow`,
      String.raw`\Updownarrow`,
      String.raw`\arrowvert`,
      String.raw`\Arrowvert`,
      String.raw`\bracevert`,
      "/",
    ]) {
      expect(pairs.get(name), name).toBe(name);
    }
  });

  it("only marks a glyph standalone when its two halves differ", () => {
    for (const entry of LATEX_DELIMITER_GLYPHS) {
      if (!entry.standalone) continue;
      expect(entry.open, entry.open).not.toBe(entry.close);
    }
  });

  it("marks every symmetric glyph as a separator", () => {
    for (const entry of LATEX_DELIMITER_GLYPHS) {
      if (entry.open !== entry.close) continue;
      expect(entry.separator, entry.open).toBe(true);
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

  it("allows horizontal space between the command and its glyph", () => {
    expect(latexDelimiterPrefixBefore("\\left ")?.length).toBe(6);
    expect(latexDelimiterPrefixBefore("\\bigl\t\\")?.escapedSlash).toBe(true);
    expect(latexDelimiterPrefixBefore("\\left\n")).toBeNull();
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
});

describe("latexDelimiterTakesPartner", () => {
  it("pairs every glyph after an asymmetric size command", () => {
    for (const entry of LATEX_DELIMITER_GLYPHS) {
      expect(latexDelimiterTakesPartner(size("left"), entry), entry.open).toBe(
        true,
      );
      expect(latexDelimiterTakesPartner(size("bigl"), entry), entry.open).toBe(
        true,
      );
    }
  });

  it("pairs only asymmetric glyphs after a symmetric size command", () => {
    expect(latexDelimiterTakesPartner(size("big"), glyph("("))).toBe(true);
    expect(latexDelimiterTakesPartner(size("Bigg"), glyph(String.raw`\{`))).toBe(
      true,
    );
    expect(latexDelimiterTakesPartner(size("big"), glyph("|"))).toBe(false);
    expect(latexDelimiterTakesPartner(size("Big"), glyph(String.raw`\|`))).toBe(
      false,
    );
    expect(latexDelimiterTakesPartner(size("bigg"), glyph("/"))).toBe(false);
  });
});

describe("closer identity", () => {
  it("spells a sized closer from its command and glyph", () => {
    expect(latexDelimiterCloserText(RIGHT_PAREN)).toBe(String.raw`\right)`);
    expect(latexDelimiterCloserText(RIGHT_BRACE)).toBe(String.raw`\right\}`);
    expect(latexDelimiterCloserText(BIG_PAREN)).toBe(String.raw`\big)`);
  });

  it("spells a standalone closer as the glyph alone", () => {
    expect(latexDelimiterCloserText(RANGLE)).toBe(String.raw`\rangle`);
  });

  it("builds openings and closings from the same two halves", () => {
    const entry = glyph(String.raw`\langle`);
    expect(latexDelimiterOpening(size("Biggl"), entry)).toBe(
      String.raw`\Biggl\langle`,
    );
    expect(latexDelimiterClosing(size("Biggl"), entry)).toBe(
      String.raw`\Biggr\rangle`,
    );
    expect(latexDelimiterCloserFor(size("big"), glyph("["))).toEqual({
      command: "big",
      glyph: "]",
    });
  });
});

describe("latexDelimiterClosesAhead", () => {
  it("recognises a closing size command and a named closing glyph", () => {
    expect(latexDelimiterClosesAhead(String.raw`\right)`)).toBe(true);
    expect(latexDelimiterClosesAhead(String.raw`\Biggr]`)).toBe(true);
    expect(latexDelimiterClosesAhead(String.raw`\rangle`)).toBe(true);
    expect(latexDelimiterClosesAhead(String.raw`\rvert x`)).toBe(true);
  });

  it("recognises a symmetric size command and the math closers", () => {
    expect(latexDelimiterClosesAhead(String.raw`\big)`)).toBe(true);
    expect(latexDelimiterClosesAhead(String.raw`\]`)).toBe(true);
    expect(latexDelimiterClosesAhead(String.raw`\)`)).toBe(true);
    expect(latexDelimiterClosesAhead(String.raw`\}`)).toBe(true);
    expect(latexDelimiterClosesAhead(String.raw`\|`)).toBe(true);
    expect(latexDelimiterClosesAhead(String.raw`\\`)).toBe(true);
  });

  it("treats an opening size command and content commands as content", () => {
    expect(latexDelimiterClosesAhead(String.raw`\left(`)).toBe(false);
    expect(latexDelimiterClosesAhead(String.raw`\bigl(`)).toBe(false);
    expect(latexDelimiterClosesAhead(String.raw`\frac{a}{b}`)).toBe(false);
    expect(latexDelimiterClosesAhead(String.raw`\alpha`)).toBe(false);
    expect(latexDelimiterClosesAhead("x")).toBe(false);
    expect(latexDelimiterClosesAhead("")).toBe(false);
  });
});

describe("latexDelimiterCloserConsumption", () => {
  it("steps over a closer when its glyph is typed bare", () => {
    expect(latexDelimiterCloserConsumption("x", ")", RIGHT_PAREN)).toBe(0);
    expect(latexDelimiterCloserConsumption("x", "|", RIGHT_BAR)).toBe(0);
    expect(latexDelimiterCloserConsumption("x", "}", RIGHT_BRACE)).toBe(0);
  });

  it("consumes a closer the user spells out in full", () => {
    expect(
      latexDelimiterCloserConsumption(String.raw`x\right`, ")", RIGHT_PAREN),
    ).toBe(String.raw`\right`.length);
    expect(
      latexDelimiterCloserConsumption("x\\right\\", "}", RIGHT_BRACE),
    ).toBe("\\right\\".length);
    expect(
      latexDelimiterCloserConsumption(String.raw`x\big`, ")", BIG_PAREN),
    ).toBe(String.raw`\big`.length);
    expect(
      latexDelimiterCloserConsumption(
        String.raw`x\right\rangl`,
        "e",
        RIGHT_RANGLE,
      ),
    ).toBe(String.raw`\right\rangl`.length);
  });

  it("consumes a spelled closer whose size command carries a space", () => {
    expect(
      latexDelimiterCloserConsumption(String.raw`x\right `, ")", RIGHT_PAREN),
    ).toBe(String.raw`\right `.length);
  });

  it("consumes an escaped glyph typed on its own", () => {
    expect(
      latexDelimiterCloserConsumption("x\\", "}", RIGHT_BRACE),
    ).toBe(1);
    expect(
      latexDelimiterCloserConsumption("x\\", "|", RIGHT_NORM),
    ).toBe(1);
  });

  it("consumes a named glyph typed without its size command", () => {
    expect(
      latexDelimiterCloserConsumption(String.raw`x\rangl`, "e", RIGHT_RANGLE),
    ).toBe(String.raw`\rangl`.length);
    expect(latexDelimiterCloserConsumption(String.raw`x\rangl`, "e", RANGLE)).toBe(
      String.raw`\rangl`.length,
    );
  });

  it("refuses a glyph that does not end the closer", () => {
    expect(latexDelimiterCloserConsumption("x", "]", RIGHT_PAREN)).toBeNull();
    expect(latexDelimiterCloserConsumption("x", "e", RIGHT_PAREN)).toBeNull();
    expect(latexDelimiterCloserConsumption("x", "))", RIGHT_PAREN)).toBeNull();
  });

  it("refuses a closer spelled with a different size command", () => {
    expect(
      latexDelimiterCloserConsumption(String.raw`x\bigr`, ")", RIGHT_PAREN),
    ).toBeNull();
    expect(
      latexDelimiterCloserConsumption(String.raw`x\left`, ")", RIGHT_PAREN),
    ).toBeNull();
    expect(
      latexDelimiterCloserConsumption("x\\right\\", ")", RIGHT_PAREN),
    ).toBeNull();
    expect(
      latexDelimiterCloserConsumption(String.raw`x\right`, "}", RIGHT_BRACE),
    ).toBeNull();
  });

  it("keeps a literal escape the user is typing", () => {
    expect(
      latexDelimiterCloserConsumption("x\\", ")", RIGHT_PAREN),
    ).toBeNull();
    expect(
      latexDelimiterCloserConsumption("x\\\\", ")", RIGHT_PAREN),
    ).toBe(0);
    expect(
      latexDelimiterCloserConsumption("x\\\\", "}", RIGHT_BRACE),
    ).toBe(0);
  });

  it("ignores a spelled closer whose backslash is itself escaped", () => {
    expect(
      latexDelimiterCloserConsumption(String.raw`x\\rangl`, "e", RIGHT_RANGLE),
    ).toBeNull();
  });

  it("keeps the glyph while an inner opener is still unclosed", () => {
    expect(latexDelimiterCloserConsumption("(a+b", ")", RIGHT_PAREN)).toBeNull();
    expect(latexDelimiterCloserConsumption("(a+b)", ")", RIGHT_PAREN)).toBe(0);
    expect(latexDelimiterCloserConsumption("(a)(b", ")", RIGHT_PAREN)).toBeNull();
    expect(
      latexDelimiterCloserConsumption(String.raw`\{a`, "}", RIGHT_BRACE),
    ).toBeNull();
    expect(
      latexDelimiterCloserConsumption("\\{a\\}\\", "}", RIGHT_BRACE),
    ).toBe(1);
    expect(
      latexDelimiterCloserConsumption(
        String.raw`a \langle b \rangl`,
        "e",
        RIGHT_RANGLE,
      ),
    ).toBeNull();
  });

  it("consumes a closer spelled in full even inside an unclosed opener", () => {
    expect(
      latexDelimiterCloserConsumption("(a\\right", ")", RIGHT_PAREN),
    ).toBe(String.raw`\right`.length);
    expect(
      latexDelimiterCloserConsumption(
        String.raw`\langle b \right\rangl`,
        "e",
        RIGHT_RANGLE,
      ),
    ).toBe(String.raw`\right\rangl`.length);
  });

  it("checks the whole body rather than the last few characters", () => {
    const body = `(${"a".repeat(200)}`;
    expect(latexDelimiterCloserConsumption(body, ")", RIGHT_PAREN)).toBeNull();
    expect(latexDelimiterCloserConsumption(`${body})`, ")", RIGHT_PAREN)).toBe(
      0,
    );
  });
});

describe("latexDelimiterUnclosedInside", () => {
  it("counts unescaped glyphs and ignores escaped ones", () => {
    expect(latexDelimiterUnclosedInside("(", RIGHT_PAREN)).toBe(true);
    expect(latexDelimiterUnclosedInside("()", RIGHT_PAREN)).toBe(false);
    expect(latexDelimiterUnclosedInside(String.raw`\(a`, RIGHT_PAREN)).toBe(false);
    expect(latexDelimiterUnclosedInside(String.raw`\\(a`, RIGHT_PAREN)).toBe(true);
    expect(
      latexDelimiterUnclosedInside(String.raw`\left(a\right)`, RIGHT_PAREN),
    ).toBe(false);
  });

  it("counts escaped braces and named glyphs as whole tokens", () => {
    expect(latexDelimiterUnclosedInside("{a", RIGHT_BRACE)).toBe(false);
    expect(latexDelimiterUnclosedInside(String.raw`\{a`, RIGHT_BRACE)).toBe(true);
    expect(
      latexDelimiterUnclosedInside(String.raw`\langle a`, RIGHT_RANGLE),
    ).toBe(true);
    expect(
      latexDelimiterUnclosedInside(String.raw`\langlex a`, RIGHT_RANGLE),
    ).toBe(false);
    expect(
      latexDelimiterUnclosedInside(String.raw`\langle a \rangle`, RIGHT_RANGLE),
    ).toBe(false);
  });

  it("never reports a symmetric glyph as unclosed", () => {
    expect(latexDelimiterUnclosedInside("|a|b", RIGHT_BAR)).toBe(false);
    expect(latexDelimiterUnclosedInside(String.raw`\|a`, RIGHT_NORM)).toBe(false);
  });
});

describe("latexEmptyDelimiterPairAt", () => {
  it("measures an empty sized pair", () => {
    expect(latexEmptyDelimiterPairAt("\\left(", "\\right)")).toEqual({
      opener: 6,
      closer: 7,
    });
    expect(
      latexEmptyDelimiterPairAt("x \\Biggl\\langle", "\\Biggr\\rangle y"),
    ).toEqual({ opener: 13, closer: 13 });
    expect(latexEmptyDelimiterPairAt("\\left\\{", "\\right\\}")).toEqual({
      opener: 7,
      closer: 8,
    });
  });

  it("measures a pair whose opener carries a space and a null pair", () => {
    expect(latexEmptyDelimiterPairAt("\\left (", "\\right)")).toEqual({
      opener: 7,
      closer: 7,
    });
    expect(latexEmptyDelimiterPairAt("\\left.", "\\right.")).toEqual({
      opener: 6,
      closer: 7,
    });
    expect(latexEmptyDelimiterPairAt("\\bigl.", "\\bigr.")).toBeNull();
  });

  it("measures an empty standalone pair", () => {
    expect(latexEmptyDelimiterPairAt("\\langle", "\\rangle")).toEqual({
      opener: 7,
      closer: 7,
    });
    expect(latexEmptyDelimiterPairAt("\\vert", "\\vert")).toBeNull();
  });

  it("ignores an escaped opener and a mismatched closer", () => {
    expect(latexEmptyDelimiterPairAt("\\\\left(", "\\right)")).toBeNull();
    expect(latexEmptyDelimiterPairAt("\\\\langle", "\\rangle")).toBeNull();
    expect(latexEmptyDelimiterPairAt("\\left(", "\\right]")).toBeNull();
    expect(latexEmptyDelimiterPairAt("\\left(", "x\\right)")).toBeNull();
    expect(latexEmptyDelimiterPairAt("\\left+", "\\right+")).toBeNull();
  });

  it("ignores a pair whose halves come from different size families", () => {
    expect(latexEmptyDelimiterPairAt("\\bigl(", "\\Bigr)")).toBeNull();
    expect(latexEmptyDelimiterPairAt("\\right(", "\\right)")).toBeNull();
  });

  it("ignores a symmetric glyph after a symmetric size", () => {
    expect(latexEmptyDelimiterPairAt("\\big|", "\\big|")).toBeNull();
    expect(latexEmptyDelimiterPairAt("\\big(", "\\big)")).toEqual({
      opener: 5,
      closer: 5,
    });
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
      String.raw`\left\uparrow`,
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

  it("offers the standalone semantic pairs and the bare size commands", () => {
    const all = labels();
    for (const label of [
      String.raw`\langle`,
      String.raw`\rangle`,
      String.raw`\lvert`,
      String.raw`\lVert`,
      String.raw`\left`,
      String.raw`\right`,
      String.raw`\middle`,
      String.raw`\bigl`,
      String.raw`\Biggm`,
      String.raw`\big`,
    ]) {
      expect(all.has(label), label).toBe(true);
    }
    expect(all.has(String.raw`\vert`)).toBe(false);
    expect(all.has(String.raw`\uparrow`)).toBe(false);
  });

  it("pairs an opener with the closer it inserts", () => {
    expect(spec(String.raw`\left(`)).toEqual({
      kind: "pair",
      label: String.raw`\left(`,
      detail: String.raw`\left( ... \right)`,
      closer: RIGHT_PAREN,
    });
    expect(spec(String.raw`\left\{`)).toMatchObject({
      kind: "pair",
      closer: RIGHT_BRACE,
    });
    expect(spec(String.raw`\left.`)).toMatchObject({
      kind: "pair",
      closer: { command: "right", glyph: "." },
    });
    expect(spec(String.raw`\langle`)).toMatchObject({
      kind: "pair",
      closer: RANGLE,
    });
  });

  it("marks closers so accepting one can consume its pending partner", () => {
    expect(spec(String.raw`\right)`)).toEqual({
      kind: "closer",
      label: String.raw`\right)`,
      detail: String.raw`\left( ... \right)`,
      closer: RIGHT_PAREN,
    });
    expect(spec(String.raw`\right.`)).toMatchObject({ kind: "closer" });
    expect(spec(String.raw`\rangle`)).toMatchObject({
      kind: "closer",
      closer: RANGLE,
    });
    expect(spec(String.raw`\big)`)).toMatchObject({
      kind: "closer",
      closer: BIG_PAREN,
    });
  });

  it("offers separators and symmetric fixed sizes without a partner", () => {
    for (const label of [
      String.raw`\middle|`,
      String.raw`\middle\vert`,
      String.raw`\bigm|`,
      String.raw`\Biggm\Vert`,
      String.raw`\big|`,
      String.raw`\Bigg\|`,
      String.raw`\left`,
      String.raw`\right`,
    ]) {
      expect(spec(label).kind, label).toBe("plain");
    }
  });

  it("names every entry once", () => {
    expect(labels().size).toBe(LATEX_DELIMITER_COMPLETIONS.length);
  });

  it("never offers a closer as something that opens a pair", () => {
    for (const entry of LATEX_DELIMITER_COMPLETIONS) {
      if (!entry.label.startsWith("\\right")) continue;
      expect(entry.kind, entry.label).not.toBe("pair");
    }
  });
});

describe("latexDelimiterFamilySpecs", () => {
  it("scopes an opening family to openers of that size", () => {
    const specs = latexDelimiterFamilySpecs({
      size: size("left"),
      role: "open",
    });
    const found = specs.map((entry) => entry.label);
    expect(found).toContain(String.raw`\left\langle`);
    expect(found).toContain(String.raw`\left\Updownarrow`);
    expect(found).toContain(String.raw`\left.`);
    expect(found).not.toContain(String.raw`\right\rangle`);
    expect(found.every((label) => label.startsWith("\\left"))).toBe(true);
    expect(specs.every((entry) => entry.kind === "pair")).toBe(true);
  });

  it("scopes a closing family to closers of that size", () => {
    const specs = latexDelimiterFamilySpecs({
      size: size("bigl"),
      role: "close",
    });
    const found = specs.map((entry) => entry.label);
    expect(found).toContain(String.raw`\bigr\rangle`);
    expect(found).not.toContain(String.raw`\bigl\langle`);
    expect(found).not.toContain(String.raw`\bigr.`);
    expect(specs.every((entry) => entry.kind === "closer")).toBe(true);
  });

  it("scopes a separator family to bar-like glyphs", () => {
    const found = latexDelimiterFamilySpecs({
      size: size("left"),
      role: "middle",
    }).map((entry) => entry.label);
    expect(found).toContain(String.raw`\middle|`);
    expect(found).toContain(String.raw`\middle\Vert`);
    expect(found).toContain(String.raw`\middle\uparrow`);
    expect(found).not.toContain(String.raw`\middle(`);
    expect(found).not.toContain(String.raw`\middle\langle`);
  });

  it("gives a symmetric fixed size no separator forms", () => {
    expect(
      latexDelimiterFamilySpecs({ size: size("big"), role: "middle" }),
    ).toEqual([]);
  });

  it("leaves symmetric glyphs unpaired under a symmetric fixed size", () => {
    const specs = latexDelimiterFamilySpecs({
      size: size("big"),
      role: "open",
    });
    expect(specs.find((entry) => entry.label === String.raw`\big|`)?.kind).toBe(
      "plain",
    );
    expect(specs.find((entry) => entry.label === String.raw`\big(`)?.kind).toBe(
      "pair",
    );
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
