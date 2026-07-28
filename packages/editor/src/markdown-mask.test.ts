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
});
