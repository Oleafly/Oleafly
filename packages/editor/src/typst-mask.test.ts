import { describe, expect, it } from "vitest";
import {
  maskTypstToProse,
  typstSpellcheckRanges,
  typstToProse,
} from "./typst-mask";

describe("Typst prose masking", () => {
  it("preserves offsets while excluding code, comments, math, raw, labels, and citations", () => {
    const source = [
      "= Visible heading",
      "Keep *visible prose* and #emph[shown words].",
      "#let hidden = \"implementation\"",
      "Math $x_hidden + y$ and @citation remain excluded.",
      "`rawword` // commentword",
      "<section-label>",
    ].join("\n");
    const masked = maskTypstToProse(source);
    expect(masked).toHaveLength(source.length);
    expect(masked.split("\n")).toHaveLength(source.split("\n").length);
    expect(masked).toContain("Visible heading");
    expect(masked).toContain("visible prose");
    expect(masked).toContain("shown words");
    expect(masked).not.toContain("implementation");
    expect(masked).not.toContain("x_hidden");
    expect(masked).not.toContain("citation");
    expect(masked).not.toContain("rawword");
    expect(masked).not.toContain("commentword");
    expect(masked).not.toContain("section-label");
  });

  it("maps grammar and spelling ranges back to exact source text", () => {
    const source =
      "= Heading\n#link(\"https://example.test/path\")[Visible Softwar] @paper";
    const { prose, map } = typstToProse(source);
    expect(prose).toContain("Heading");
    expect(prose).toContain("Visible Softwar");
    expect(prose).not.toContain("example");
    expect(prose).not.toContain("paper");
    expect(map).toHaveLength(prose.length);
    const at = prose.indexOf("Softwar");
    expect(source.slice(map[at], map[at + 6] + 1)).toBe("Softwar");

    const ranges = typstSpellcheckRanges(source);
    expect(ranges.map((range) => range.word)).toEqual([
      "Heading",
      "Visible",
      "Softwar",
    ]);
    for (const range of ranges) {
      expect(source.slice(range.from, range.to)).toBe(range.word);
    }
  });

  it("masks chained code members without masking visible content", () => {
    const source =
      "#model.encoder.run(input).result [Visible prose remains]";
    const masked = maskTypstToProse(source);

    expect(masked).not.toContain("model");
    expect(masked).not.toContain("encoder");
    expect(masked).not.toContain("run");
    expect(masked).not.toContain("input");
    expect(masked).not.toContain("result");
    expect(masked).toContain("Visible prose remains");
    expect(masked).toHaveLength(source.length);
    expect(typstSpellcheckRanges(source).map((range) => range.word)).toEqual([
      "Visible",
      "prose",
      "remains",
    ]);
  });

  it("preserves rendered control-flow content with exact offsets", () => {
    const source = [
      "#if enabled [Primary rendered prose] else if fallback [Fallback rendered prose] else [Final rendered prose]",
      "#for item in items [Rendered item: #item]",
      "#while active [Loop rendered prose]",
    ].join("\n");
    const masked = maskTypstToProse(source);

    expect(masked).toHaveLength(source.length);
    expect(masked).toContain("Primary rendered prose");
    expect(masked).toContain("Fallback rendered prose");
    expect(masked).toContain("Final rendered prose");
    expect(masked).toContain("Rendered item");
    expect(masked).toContain("Loop rendered prose");
    expect(masked).not.toContain("enabled");
    expect(masked).not.toContain("fallback");
    expect(masked).not.toContain("items");
    expect(masked).not.toContain("#item");
    for (const phrase of [
      "Primary rendered prose",
      "Fallback rendered prose",
      "Final rendered prose",
      "Rendered item",
      "Loop rendered prose",
    ]) {
      const at = masked.indexOf(phrase);
      expect(source.slice(at, at + phrase.length)).toBe(phrase);
    }
  });

  it("preserves same-line prose after a terminated let statement", () => {
    const source =
      '#let hidden = "implementation detail"; Visible prose after the statement';
    const masked = maskTypstToProse(source);

    expect(masked).toHaveLength(source.length);
    expect(masked).not.toContain("hidden");
    expect(masked).not.toContain("implementation");
    expect(masked).toContain("Visible prose after the statement");
    expect(typstSpellcheckRanges(source).map((range) => range.word)).toEqual([
      "Visible",
      "prose",
      "after",
      "the",
      "statement",
    ]);
  });

  it.each([
    [
      "an escaped content delimiter",
      String.raw`#if cond [Visible \[ prose] else [Fallback prose]`,
    ],
    [
      "nested block comments",
      "#if cond [Primary /* outer /* ] */ still */ prose] else [Fallback prose]",
    ],
    [
      "raw spans",
      "#if cond [Primary `]` prose] else [Fallback prose]",
    ],
    [
      "math spans",
      "#if cond [Primary $display(])$ prose] else [Fallback prose]",
    ],
  ])(
    "keeps chained branches aligned around %s",
    (_description, source) => {
      const masked = maskTypstToProse(source);
      const words = typstSpellcheckRanges(source).map(
        (range) => range.word,
      );

      expect(masked).toHaveLength(source.length);
      expect(masked).toMatch(/(?:Visible|Primary).*\bprose\b/u);
      expect(masked).toContain("prose");
      expect(masked).toContain("Fallback prose");
      expect(masked).not.toContain(" else ");
      expect(words).not.toContain("else");
      expect(words).not.toContain("cond");
    },
  );
});

describe("Typst email addresses", () => {
  it("masks addresses with non-ASCII local parts before citations claim the at-sign", () => {
    const source = "Napište na пример@почта.рф nebo ředitel@firma.cz dnes, viz @knuth.";
    expect(typstSpellcheckRanges(source).map((range) => range.word)).toEqual([
      "Napište",
      "na",
      "nebo",
      "dnes",
      "viz",
    ]);
  });
});

describe("Typst prose masking outside ASCII", () => {
  const words = (source: string) =>
    typstSpellcheckRanges(source).map((range) => range.word);

  it("masks whole calls with combining-mark and NFD identifiers", () => {
    expect(words('यो #परिणाम("गणना मान", विधि: "तेज") हो')).toEqual(["यो", "हो"]);
    const decomposed = 'Text #výsledek("skrytý kód", režim: 1) konec'.normalize("NFD");
    expect(words(decomposed)).toEqual(["Text", "konec"]);
    expect(words("Text #model.výstup(\"skryto\") konec")).toEqual(["Text", "konec"]);
  });

  it("masks digit-first and dotted references without the sentence period", () => {
    const source = "Viz @2020dvořák a @obr.1.";
    const masked = maskTypstToProse(source);
    expect(words(source)).toEqual(["Viz"]);
    expect(masked.endsWith(".")).toBe(true);
  });

  it("keeps prose after escaped characters", () => {
    expect(words("Cena je 5 \\$.\n\nDruhý odstavec obsahuje chiba slovo.\n")).toEqual(
      ["Cena", "je", "Druhý", "odstavec", "obsahuje", "chiba", "slovo"],
    );
    expect(words("Cena 5 \\$ a 10 \\$ celkem.")).toEqual(["Cena", "celkem"]);
    expect(words("Text \\#hashtag a \\u{1F600} slovo.")).toEqual([
      "Text",
      "hashtag",
      "slovo",
    ]);
    expect(words("Mail jan\\@firma.cz dnes.")).toEqual(["Mail", "jan", "dnes"]);
    expect(words("Znak \\u{41 slovo a \\u{1F600}konec")).toEqual([
      "Znak",
      "slovo",
      "konec",
    ]);
  });

  it("masks URLs instead of treating them as line comments", () => {
    const source = "Viz https://example.com/a a pak chiba tady. https://a.b // skryto";
    expect(words(source)).toEqual(["Viz", "pak", "chiba", "tady"]);
    const caption =
      "#figure(image(\"a.png\"), caption: [Viz https://x.org/y])\nDalší odstavec chiba.\n";
    expect(words(caption)).toEqual(["Další", "odstavec", "chiba"]);
  });
});
