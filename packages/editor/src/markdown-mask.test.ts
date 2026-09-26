import { describe, expect, it } from "vitest";
import { markdownSpellcheckRanges, markdownToProse, maskMarkdown } from "./markdown-mask";

describe("Markdown prose masking", () => {
  it("masks fenced code, inline code, URLs, link destinations, and math", () => {
    const source = "Keep 50% prose `codeword` [label](https://example.test/path) $x_value$\n```ts\nfencedword\n```\nAfter";
    const masked = maskMarkdown(source);
    expect(masked).toContain("Keep 50% prose");
    expect(masked).not.toContain("codeword");
    expect(masked).not.toContain("example");
    expect(masked).not.toContain("x_value");
    expect(masked).not.toContain("fencedword");
    expect(masked).toContain("After");
  });

  it("keeps prose offsets while excluding masked words", () => {
    const source = "Alpha `hidden` Beta at 50% completion.";
    const ranges = markdownSpellcheckRanges(source);
    expect(ranges.map((range) => range.word)).toEqual(["Alpha", "Beta", "at", "completion"]);
    const { prose, map } = markdownToProse(source);
    expect(prose).toBe("Alpha Beta at 50% completion.");
    expect(source.slice(map[6], map[9] + 1)).toBe("Beta");
  });

  it("masks Pandoc citations without hiding neighboring prose", () => {
    const source =
      "Prior work [see @vaswani2017, pp. 4-5; @doe2020] supports @smith2024 today.";
    const ranges = markdownSpellcheckRanges(source);
    const words = ranges.map((range) => range.word);
    expect(words).toContain("Prior");
    expect(words).toContain("supports");
    expect(words).toContain("today");
    expect(words).not.toContain("vaswani");
    expect(words).not.toContain("doe");
    expect(words).not.toContain("smith");
    for (const range of ranges) {
      expect(source.slice(range.from, range.to)).toBe(range.word);
    }
  });

  it("masks a bracketed cite whose first at-sign starts no citation key", () => {
    const source = "Ask [contact @ desk, see @smith2024] before filing.";
    const masked = maskMarkdown(source);
    expect(masked).toContain("Ask");
    expect(masked).toContain("before filing.");
    expect(masked).not.toContain("contact");
    expect(masked).not.toContain("desk");
    expect(masked).not.toContain("smith2024");
    expect(masked).toHaveLength(source.length);
  });

  it("leaves a bracketed span with no citation key alone", () => {
    const source = "Ask [the front desk @ noon] before filing.";
    const masked = maskMarkdown(source);
    expect(masked).toContain("front desk");
    expect(masked).toContain("noon");
  });
});

describe("Pandoc attributes", () => {
  it("masks the toolbar underline and highlight syntax but keeps the text", () => {
    const source =
      "Toto je [důležité]{.underline} a [zvýrazněné]{.mark} slovo.";
    const words = markdownSpellcheckRanges(source).map((range) => range.word);
    expect(words).toEqual(["Toto", "je", "důležité", "a", "zvýrazněné", "slovo"]);
    expect(markdownToProse(source).prose).toBe(
      "Toto je důležité a zvýrazněné slovo.",
    );
    expect(maskMarkdown(source)).toHaveLength(source.length);
  });

  it("masks heading ids, image attributes, inline code attributes and div fences", () => {
    const source = [
      "# Výsledky měření {#sec:vysledky-mereni}",
      "",
      "Setext nadpis {.unnumbered}",
      "---------------------------",
      "",
      "![Graf průběhu](graf.png){width=80%}",
      "",
      "Kód `print()`{.python} tady.",
      "",
      "::: {.note}",
      "Poznámka.",
      ":::",
      "::: warning",
      "Pozor.",
      ":::",
    ].join("\n");
    const words = markdownSpellcheckRanges(source).map((range) => range.word);
    expect(words).toEqual([
      "Výsledky",
      "měření",
      "Setext",
      "nadpis",
      "Graf",
      "průběhu",
      "Kód",
      "tady",
      "Poznámka",
      "Pozor",
    ]);
    expect(maskMarkdown(source).split("\n")).toHaveLength(
      source.split("\n").length,
    );
  });

  it("leaves braces in ordinary prose alone", () => {
    const source = "The set {apples, pears} is small.";
    expect(markdownSpellcheckRanges(source).map((range) => range.word)).toEqual([
      "The",
      "set",
      "apples",
      "pears",
      "is",
      "small",
    ]);
  });
});

describe("Markdown email addresses", () => {
  it("masks addresses with non-ASCII local parts and domains", () => {
    const source = "Napište na пример@почта.рф nebo ředitel@firma.cz a jan@firma.рф dnes.";
    expect(markdownSpellcheckRanges(source).map((range) => range.word)).toEqual([
      "Napište",
      "na",
      "nebo",
      "a",
      "dnes",
    ]);
  });
});
