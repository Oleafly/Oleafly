import { describe, expect, it } from "vitest";
import { intersectsMaskedRegion } from "./latex-mask";
import {
  decodeTypstProse,
  maskTypstForProseRegions,
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
    expect(words(caption)).toEqual(["Viz", "Další", "odstavec", "chiba"]);
  });
});

const proseWords = (source: string) =>
  typstSpellcheckRanges(source).map((range) => range.word);

describe("Typst stray quotes inside content", () => {
  it("keeps the rest of the document after a quote in a table cell", () => {
    const source =
      '#table(columns: 2, [5" wide], [b])\nLater paragraf text here.';
    expect(proseWords(source)).toEqual([
      "wide",
      "Later",
      "paragraf",
      "text",
      "here",
    ]);
    expect(maskTypstToProse(source)).toHaveLength(source.length);
  });

  it("keeps the rest of the document after a quote in a caption", () => {
    const source =
      '#figure(caption: [A 5" screen])\nMore prose wrods here.';
    expect(proseWords(source)).toEqual([
      "screen",
      "More",
      "prose",
      "wrods",
      "here",
    ]);
  });

  it("treats a quote as text in every markup context", () => {
    expect(proseWords('#emph[a 5" gap] and more wrods')).toEqual([
      "gap",
      "and",
      "more",
      "wrods",
    ]);
    expect(
      proseWords('#if cond [a 5" gap] else [the other branch]\nTail line'),
    ).toEqual(["gap", "the", "other", "branch", "Tail", "line"]);
    expect(proseWords('#{ [a 5" gap] }\nTail line')).toEqual([
      "gap",
      "Tail",
      "line",
    ]);
  });

  it("still masks a quoted string in code next to a content argument", () => {
    expect(
      proseWords('#figure(image("plot[1].png"), caption: [Shown captoin])'),
    ).toEqual(["Shown", "captoin"]);
  });
});

describe("Typst content arguments", () => {
  it("checks a named caption and masks the code around it", () => {
    const source =
      '#figure(image("diagram.png", width: 80%), caption: [A captoin here], supplement: [Figure], placement: top, gap: 1em, kind: "image")';
    expect(proseWords(source)).toEqual(["captoin", "here", "Figure"]);
  });

  it("checks table and grid cells", () => {
    expect(
      proseWords(
        "#table(columns: (1fr, 2fr), align: left, [Cell twoo], [Other cell])",
      ),
    ).toEqual(["Cell", "twoo", "Other", "cell"]);
    expect(
      proseWords("#grid(columns: 2, gutter: 3pt, [Left side], [Rigth side])"),
    ).toEqual(["Left", "side", "Rigth", "side"]);
  });

  it("checks a template title and abstract", () => {
    const source = [
      "#import \"@preview/charged-ieee:0.1.0\": ieee",
      "#show: ieee.with(",
      "  title: [A Titel for the paper],",
      "  authors: ((name: \"Ada Lovelace\", organization: [Analytical Society]),),",
      "  abstract: [This abstrct reads well.],",
      "  index-terms: (\"Scientific writing\", \"Typesetting\"),",
      "  bibliography: bibliography(\"refs.bib\"),",
      ")",
      "Body text.",
    ].join("\n");
    expect(proseWords(source)).toEqual([
      "Titel",
      "for",
      "the",
      "paper",
      "Analytical",
      "Society",
      "This",
      "abstrct",
      "reads",
      "well",
      "Body",
      "text",
    ]);
  });

  it("checks an outline title and a footnote nested in a caption", () => {
    expect(proseWords("#outline(title: [Contnts], depth: 2)")).toEqual([
      "Contnts",
    ]);
    expect(
      proseWords("#figure(rect(), caption: [Caption #footnote[Nested notte]])"),
    ).toEqual(["Caption", "Nested", "notte"]);
  });

  it("checks a styled text argument but not its options", () => {
    expect(
      proseWords('#text(fill: rgb("#ff0000"), size: 12pt)[Red wrods]'),
    ).toEqual(["Red", "wrods"]);
  });

  it("keeps the offsets of argument prose exact", () => {
    const source = "#figure(rect(), caption: [Visible captoin])";
    for (const range of typstSpellcheckRanges(source)) {
      expect(source.slice(range.from, range.to)).toBe(range.word);
    }
    expect(maskTypstToProse(source)).toHaveLength(source.length);
  });
});

describe("Typst context expressions", () => {
  it("masks the expression after context", () => {
    expect(proseWords("#context text.lang")).toEqual([]);
    expect(proseWords("#context counter(page).display()")).toEqual([]);
  });

  it("keeps prose after the context expression ends", () => {
    expect(proseWords("#context text.lang is the langauge.")).toEqual([
      "is",
      "the",
      "langauge",
    ]);
  });

  it("checks content inside a context block but not its code", () => {
    expect(
      proseWords(
        "#context { let x = counter(page).get(); [Page #x of the documnet] }",
      ),
    ).toEqual(["Page", "of", "the", "documnet"]);
    expect(proseWords("#context [Current pagge]")).toEqual([
      "Current",
      "pagge",
    ]);
  });
});

describe("Typst code blocks", () => {
  it("checks content blocks inside a code block", () => {
    expect(proseWords("#{ let x = 1; [Hello wrold] }")).toEqual([
      "Hello",
      "wrold",
    ]);
  });

  it("checks both branches of a braced conditional", () => {
    expect(
      proseWords("#if x > 1 { [Branch prose] } else { [Other prose] }"),
    ).toEqual(["Branch", "prose", "Other", "prose"]);
  });

  it("skips brackets inside strings and comments in code", () => {
    expect(
      proseWords(
        '#{\n  let s = "[not prose]"\n  // [comment text]\n  /* [more] */\n  [Shown text]\n}',
      ),
    ).toEqual(["Shown", "text"]);
  });

  it("checks content in loops, functions, and show rules", () => {
    expect(proseWords("#{ for x in (1, 2) { [Item #x] } }")).toEqual([
      "Item",
    ]);
    expect(proseWords("#let greet(name) = [Hello #name, welcme]")).toEqual([
      "Hello",
      "welcme",
    ]);
    expect(proseWords("#show heading: it => [Chapter #it.body]")).toEqual([
      "Chapter",
    ]);
  });

  it("keeps prose after a conditional without an else branch", () => {
    expect(proseWords("#if cond [Shown] Trailing prose")).toEqual([
      "Shown",
      "Trailing",
      "prose",
    ]);
  });
});

describe("Typst strings in code", () => {
  it("masks a parenthesized string expression", () => {
    expect(proseWords('#("some strng text")')).toEqual([]);
    expect(proseWords('Before #("some strng text") after')).toEqual([
      "Before",
      "after",
    ]);
  });

  it("masks strings but checks content inside an array", () => {
    expect(proseWords('#let x = ("a strng", [Visible wrd])')).toEqual([
      "Visible",
      "wrd",
    ]);
  });

  it("masks number literals after a hash", () => {
    expect(proseWords("Gap #1em wide and #12pt tall")).toEqual([
      "Gap",
      "wide",
      "and",
      "tall",
    ]);
  });
});

describe("Typst Unicode escapes", () => {
  it("decodes an escape into the word it belongs to", () => {
    const source = "Un caf\\u{e9} au lait";
    const ranges = typstSpellcheckRanges(source);
    expect(ranges.map((range) => range.word)).toEqual([
      "Un",
      "café",
      "au",
      "lait",
    ]);
    const cafe = ranges[1];
    expect(source.slice(cafe.from, cafe.to)).toBe("caf\\u{e9}");
  });

  it("decodes upper-case and multi-letter escapes", () => {
    expect(proseWords("na\\u{EF}ve and \\u{C9}cole")).toEqual([
      "naïve",
      "and",
      "École",
    ]);
  });

  it("leaves a malformed or out-of-range escape blank", () => {
    expect(proseWords("caf\\u{110000}x and caf\\u{41")).toEqual([
      "caf",
      "and",
      "caf",
    ]);
  });

  it("decodes escapes inside a content argument", () => {
    expect(proseWords("#figure(rect(), caption: [Un caf\\u{e9}])")).toEqual([
      "Un",
      "café",
    ]);
  });
});

describe("Typst include statements", () => {
  it("keeps text after an include path on the same line", () => {
    expect(proseWords('#include "a.typ" Then some txet.')).toEqual([
      "Then",
      "some",
      "txet",
    ]);
    expect(proseWords('#include "chapters/intro.typ"\nNext line')).toEqual([
      "Next",
      "line",
    ]);
  });
});

describe("Typst grammar input", () => {
  it("returns a same-length string with line breaks kept", () => {
    const source = [
      "= Results",
      "#let x = \"hidden\"",
      "We compare $a$ and $b$ in @smith2020 here.",
      "#figure(rect(), caption: [A captoin])",
    ].join("\n");
    const { prose } = maskTypstForProseRegions(source);
    expect(prose).toHaveLength(source.length);
    expect(prose.split("\n")).toHaveLength(source.split("\n").length);
    expect(prose).not.toContain("hidden");
    expect(prose).not.toContain("smith2020");
    expect(prose).toContain("A captoin");
  });

  it("names inline constructs with a placeholder noun", () => {
    expect(
      maskTypstForProseRegions("We compare $a$ and $b$ in @smith2020 here.")
        .prose,
    ).toBe("We compare X   and X   in Dummy      here.");
    expect(
      maskTypstForProseRegions("See #cite(<knuth>) for details.").prose,
    ).toBe("See Dummy          for details.");
  });

  it("blanks block constructs instead of naming them", () => {
    const { prose } = maskTypstForProseRegions(
      "Before.\n#let x = 1\n$ E = m c^2 $\n// note\nAfter.",
    );
    expect(prose).not.toContain("Dummy");
    expect(prose).toContain("Before.");
    expect(prose).toContain("After.");
  });

  it("never starts a placeholder against an adjacent word character", () => {
    const { prose } = maskTypstForProseRegions("word@knuth2020 and math$x$.");
    expect(prose).not.toMatch(/wordDummy|mathX/u);
  });

  it("reports masked regions in ascending, non-overlapping order", () => {
    const source =
      "= Head\nBody with @key and $x$ and #emph[stress] #context text.lang.";
    const { masked } = maskTypstForProseRegions(source);
    expect(masked.length).toBeGreaterThan(0);
    for (let index = 1; index < masked.length; index++) {
      expect(masked[index].from).toBeGreaterThanOrEqual(masked[index - 1].to);
    }
    const math = source.indexOf("$x$");
    expect(intersectsMaskedRegion(masked, math, math + 3)).toBe(true);
  });

  it("leaves untouched prose out of the regions", () => {
    const source = "We compare the the results here.";
    const { masked } = maskTypstForProseRegions(source);
    expect(masked).toEqual([]);
    expect(intersectsMaskedRegion(masked, 0, source.length)).toBe(false);
  });

  it("reports blanked markup markers and delimiters as regions", () => {
    const source = "= Head\n- We compare *the* the _results_ here.";
    const { masked } = maskTypstForProseRegions(source);
    for (const marker of ["=", "-", "*", "_"]) {
      const at = source.indexOf(marker);
      expect(intersectsMaskedRegion(masked, at, at + 1), marker).toBe(true);
    }
    const words = source.indexOf("We compare");
    expect(intersectsMaskedRegion(masked, words, words + 10)).toBe(false);
  });

  it("writes decoded escapes in place and masks their span", () => {
    const source = "Un caf\\u{e9} noir.";
    const { prose, masked } = maskTypstForProseRegions(source);
    expect(prose).toHaveLength(source.length);
    expect(prose.replace(/\s+/gu, " ")).toBe("Un café noir.");
    const at = source.indexOf("caf");
    expect(intersectsMaskedRegion(masked, at, at + 1)).toBe(true);
  });

  it("checks the same content arguments as spelling", () => {
    const source =
      '#show: ieee.with(title: [A Titel], abstract: [This abstrct])\n#figure(rect(), caption: [A captoin #footnote[Nested notte]])\n#table(columns: 2, [Cell twoo], [b])\n#context text.lang\n#let s = "strng"';
    const { prose } = maskTypstForProseRegions(source);
    const grammarWords = [...prose.matchAll(/\p{L}{2,}/gu)]
      .map((match) => match[0])
      .filter((word) => word !== "Dummy");
    expect(grammarWords).toEqual(proseWords(source));
  });

  it("decodes escapes for the compact grammar text", () => {
    const source = "Un caf\\u{e9} noir.";
    const { prose, map } = typstToProse(source);
    expect(prose).toBe("Un café noir.");
    expect(map).toHaveLength(prose.length);
    const at = prose.indexOf("café");
    expect(source.slice(map[at], map[at + 3] + 1)).toBe("caf\\u{e9}");
  });
});

describe("Typst markup edge cases", () => {
  it("checks a reference supplement but not the reference", () => {
    expect(proseWords("See @fig:plot[Figur] for more.")).toEqual([
      "See",
      "Figur",
      "for",
      "more",
    ]);
  });

  it("blanks a call that stands on its own line instead of naming it", () => {
    const { prose } = maskTypstForProseRegions(
      'Before.\n#v(1em)\n  #figure(image("a.png"))\n#pagebreak()\nAfter.',
    );
    expect(prose).not.toContain("Dummy");
    expect(prose).not.toMatch(/figure|image|pagebreak/u);
  });

  it("names an inline context value with a placeholder", () => {
    expect(
      maskTypstForProseRegions("Page #context counter(page).display() of ten.")
        .prose,
    ).toMatch(/^Page Dummy +of ten\.$/u);
  });

  it("recovers from a stray closer inside a call", () => {
    expect(proseWords("#emph[a #f(x] tail wrods")).toEqual(["tail", "wrods"]);
    expect(proseWords("#f(a, b))\nNext lne")).toEqual(["Next", "lne"]);
  });

  it("keeps a raw block and inline raw out of the prose", () => {
    const { prose } = maskTypstForProseRegions(
      "Use `code here` now.\n```py\nprint(1)\n```\nDone.",
    );
    expect(prose).toMatch(/^Use Dummy +now\./u);
    expect(prose).not.toMatch(/code|print/u);
  });
});

describe("Typst decoded prose", () => {
  it("maps decoded text back onto the source", () => {
    const source = "caf\\u{e9} caf\\u{e9}";
    const decoded = decodeTypstProse(source);
    expect(decoded.text.replace(/\s+/gu, " ")).toBe("café café");
    const second = decoded.text.lastIndexOf("café");
    expect(decoded.start(second)).toBe(source.lastIndexOf("caf"));
    expect(decoded.end(second + 3)).toBe(source.length);
  });
});

describe("Typst scanning stays linear", () => {
  const LARGE = 100_000;

  it.each([
    ["label openers", "<".repeat(LARGE)],
    ["label openers with names", "<a".repeat(LARGE / 2)],
    ["unclosed calls", "#f(".repeat(LARGE / 3)],
    ["unclosed content", "#f[".repeat(LARGE / 3)],
    ["nested brackets", "[".repeat(LARGE)],
    ["quotes in content", `#f[${'"'.repeat(LARGE)}]`],
    ["quotes in code", `#f(${'"'.repeat(LARGE)})`],
    ["context chains", "#context ".repeat(LARGE / 9)],
    ["if chains", "#if a [b] else ".repeat(LARGE / 15)],
    ["escapes", "\\u{".repeat(LARGE / 3)],
    ["hash runs", "#".repeat(LARGE)],
    ["closing brackets", "#{".concat("]".repeat(LARGE))],
    ["references", "@a".repeat(LARGE / 2)],
    ["math openers", "$".repeat(LARGE)],
    ["raw fences", "`".repeat(LARGE)],
    ["comment openers", "/*".repeat(LARGE / 2)],
    ["backslashes", "\\".repeat(LARGE)],
    ["let statements", "#let x = (\n".repeat(LARGE / 11)],
    ["spaces after a branch", `#if a [b]${" ".repeat(LARGE)}x`],
    ["else-if chains", "#if a [b] else if c [d] ".repeat(LARGE / 25)],
    ["mixed closers in code", `#f(${")}]".repeat(LARGE / 3)}`],
    ["content inside calls", `#f(${"[a](".repeat(LARGE / 4)}`],
    ["standalone calls", "#a\n".repeat(LARGE / 3)],
  ])("on %s", (_name, source) => {
    const started = performance.now();
    expect(maskTypstToProse(source)).toHaveLength(source.length);
    expect(maskTypstForProseRegions(source).prose).toHaveLength(source.length);
    typstSpellcheckRanges(source);
    typstToProse(source);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
