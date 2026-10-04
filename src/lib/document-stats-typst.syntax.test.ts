import { describe, expect, it } from "vitest";
import { typstDocumentCounts, typstDocumentSummary } from "@/lib/document-stats-typst";

describe("Typst counting across markup and code syntax", () => {
  it.each([
    ["Unicode escapes, escaped symbols and a trailing backslash", "Caf\\u{e9} and \\u{1F600 open \\# hash \\", 4],
    ["a line comment that runs to the end of the file", "Words here // trailing comment", 2],
    ["an unclosed string in code", '#let s = "never closed', 0],
    ["decimal and percentage literals in code", "#set text(size: 1.5em)\n#let ratio = 50%\nPlain words.", 2],
    ["a short Unicode escape", "\\u{1F6} done", 1],
    ["strings inside code", '#let title = "Not counted words"\nCounted words.', 2],
    ["content returned from a function definition", "#let f(x) = { return [Returned words] }\nBody.", 1],
    ["a code block with statements separated by semicolons", "#{ let a = 1; a }\nText after.", 2],
    ["a raw block", "```rust\nfn main() {}\n```\nAfter raw.", 2],
    ["a context expression", "#context [Context words]", 2],
    ["if, else-if and else branches with braces and brackets", "#if cond { [Shown words] } else if other { [Else words] } else [Last]", 5],
  ])("counts %s", (_label, source, words) => {
    expect(typstDocumentSummary(source).words).toBe(words);
  });

  it("counts a label after an emoji and keeps the emoji out of the word count", () => {
    expect(typstDocumentSummary("Smile 😀<emoji> text")).toMatchObject({ words: 2, labels: 1 });
  });

  it("treats an unclosed dollar sign as math that runs to the end", () => {
    expect(typstDocumentSummary("Before $x + y and after")).toMatchObject({ words: 1, mathInline: 1 });
  });

  it("separates inline and display math", () => {
    expect(typstDocumentSummary("$ x = y $\nInline $z$ math.")).toMatchObject({
      words: 2,
      mathInline: 1,
      mathDisplayed: 1,
    });
  });

  it("counts math and captions inside a figure call", () => {
    expect(typstDocumentSummary("#figure($x^2$, caption: [Eq])\nText.")).toMatchObject({
      words: 2,
      wordsInText: 1,
      wordsOutsideText: 1,
      figures: 1,
      mathInline: 1,
    });
  });

  it("counts references with colons and numbers as citations", () => {
    expect(typstDocumentSummary("See @fig:one and @eq:2.")).toMatchObject({ words: 2, citations: 2 });
  });

  it("counts heading words after a show rule as header words", () => {
    expect(typstDocumentSummary("#show heading: it => [#it.body]\n= Heading words")).toMatchObject({
      words: 2,
      wordsInHeaders: 2,
      headingsByLevel: [1],
    });
  });

  it("reports characters and non-empty lines of the visible text", () => {
    expect(typstDocumentCounts("#figure($x^2$, caption: [Eq])\nText.")).toMatchObject({ characters: 8, lines: 2 });
    expect(typstDocumentCounts('#let s = "never closed')).toMatchObject({ characters: 0, lines: 0 });
  });
});
