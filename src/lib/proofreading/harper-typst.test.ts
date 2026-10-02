import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Dialect, LocalLinter } from "harper.js";
import { binaryInlined as binary } from "harper.js/binaryInlined";
import {
  intersectsMaskedRegion,
  maskTypstForProseRegions,
  typstSpellcheckRanges,
  type MaskSpan,
} from "@oleafly/editor";
import { buildLintConfig } from "./lint-profile";

const CONTENT_CASES = [
  '#figure(image("a.png"), caption: [A captoin with the the repeat.])\n\nBody text here.',
  "#table(columns: 2, [Cell twoo], [the the cell])\n\nBody.",
  "#show: ieee.with(title: [A Titel], abstract: [This abstrct has has a typo.])\n\nBody.",
  "#outline(title: [Contnts])",
  "#figure(rect(), caption: [Caption #footnote[Nested notte here.]])",
  "As shown in @fig:plot, the the results hold.",
  "= Intro <sec:intro>\nThe the start.",
  "We add $x + y$ and and then stop.",
  "#let title = [My Titel here]\nText.",
  "#context { let x = counter(page).get(); [Page #x of the documnet] }",
  "#{ let x = 1; [Hello wrold] }",
  "#if x > 1 { [Brnch prose] } else { [Othr prose] }",
  '#table(columns: 2, [5" wide], [b])\nLater paragraf text here.',
  '#set text(font: "New Computer Modern", lang: "en")\nA sentense here.',
  "#emph[Emphasized wrod] and #strong[strong wrod].",
  "```rust\nfn main() { let teh = 1; }\n```\nAfter teh code.",
  '#include "a.typ" Then some txet.',
  "#show heading: it => [Chaptr #it.body]",
  "See #cite(<knuth>) for the the details.",
];

describe("Typst grammar with the real Harper", () => {
  let linter: LocalLinter;

  beforeAll(async () => {
    linter = new LocalLinter({ binary });
    await linter.setup();
    await linter.setDialect(Dialect.American);
    const rules = Object.keys(await linter.getDefaultLintConfig());
    await linter.setLintConfig(buildLintConfig([], [], rules));
    await linter.clearWords();
    await linter.importWords(["Dummy"]);
    const warmup = await linter.lint(
      "A short sentence with a Xqzvbnmlkjh word.",
      { language: "plaintext" },
    );
    for (const lint of warmup) lint.free();
  }, 30_000);

  afterAll(async () => {
    await linter.dispose();
  });

  async function findings(
    source: string,
    text: string,
    language: "plaintext" | "typst",
    masked: readonly MaskSpan[] = [],
  ): Promise<string[]> {
    const kept: string[] = [];
    for (const lint of await linter.lint(text, { language })) {
      const span = lint.span();
      if (!intersectsMaskedRegion(masked, span.start, span.end)) {
        kept.push(`${lint.lint_kind()}:${source.slice(span.start, span.end)}`);
      }
      span.free();
      lint.free();
    }
    return kept;
  }

  async function maskedFindings(source: string): Promise<string[]> {
    const { prose, masked } = maskTypstForProseRegions(source);
    return findings(source, prose, "plaintext", masked);
  }

  it("finds typos and repeats inside content arguments and code blocks", async () => {
    const found = (
      await Promise.all(CONTENT_CASES.map((source) => maskedFindings(source)))
    ).flat();
    expect(found).toEqual(
      expect.arrayContaining([
        "Spelling:captoin",
        "Repetition:the the",
        "Spelling:twoo",
        "Spelling:abstrct",
        "Repetition:has has",
        "Spelling:Contnts",
        "Spelling:notte",
        "Spelling:documnet",
        "Spelling:wrold",
        "Spelling:Brnch",
        "Spelling:Othr",
        "Spelling:paragraf",
        "Spelling:txet",
        "Spelling:Chaptr",
      ]),
    );
  }, 30_000);

  it("never reads code strings, context code, or escapes as prose", async () => {
    const source = [
      '#let wrold = "strng"',
      '#("anothr strng")',
      "#context text.lang is a langauge.",
      "A caf\\u{e9} is nice.",
    ].join("\n");
    expect(await maskedFindings(source)).toEqual(["Spelling:langauge"]);
  });

  it("drops a repeat that reaches across math, a reference, or a call", async () => {
    for (const source of [
      "We add and $c+d$ and then stop.",
      "We see and @fig:plot and then more.",
      "We add and #cite(<knuth>) and so on.",
    ]) {
      const found = await maskedFindings(source);
      expect(
        found.some((entry) => entry.startsWith("Repetition")),
        source,
      ).toBe(false);
    }
  });

  it("flags spelling only on words the spelling check also reads", async () => {
    const source = CONTENT_CASES.join("\n");
    const words = new Set(
      typstSpellcheckRanges(source).map((range) => `${range.from}:${range.to}`),
    );
    const { prose, masked } = maskTypstForProseRegions(source);
    for (const lint of await linter.lint(prose, { language: "plaintext" })) {
      const span = lint.span();
      if (
        lint.lint_kind() === "Spelling" &&
        !intersectsMaskedRegion(masked, span.start, span.end)
      ) {
        expect(words.has(`${span.start}:${span.end}`), source.slice(span.start, span.end)).toBe(true);
      }
      span.free();
      lint.free();
    }
  }, 30_000);

  it("finds everything Harper's own Typst parser finds in content", async () => {
    for (const source of CONTENT_CASES) {
      const own = await findings(source, source, "typst");
      const ours = await maskedFindings(source);
      expect(ours, source).toEqual(expect.arrayContaining(own));
    }
  }, 30_000);

  it("stays on the mask while Harper's own Typst parser reads code as prose", async () => {
    const source = [
      '#let wrold = "strng"',
      "#context text.lang is a langauge.",
      "A caf\\u{e9} is nice.",
    ].join("\n");
    const own = await findings(source, source, "typst");
    const ours = await maskedFindings(source);
    expect(own).toEqual(expect.arrayContaining(ours));
    expect(own.length).toBeGreaterThan(ours.length);
  });
});
