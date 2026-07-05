import { describe, it, expect } from "vitest";
import { countWords } from "./wordcount";

describe("countWords", () => {
  it("counts plain words, raw characters, and lines", () => {
    const r = countWords("hello world");
    expect(r.words).toBe(2);
    expect(r.characters).toBe(11);
    expect(r.lines).toBe(1);
  });

  it("counts lines by newline and characters over the raw input", () => {
    const r = countWords("a\nb\nc");
    expect(r.lines).toBe(3);
    expect(r.characters).toBe(5);
    expect(r.words).toBe(3);
  });

  it("ignores a line comment", () => {
    expect(countWords("hello % this is ignored").words).toBe(1);
  });

  it("does NOT treat an escaped percent as a comment", () => {
    // `\%` is a literal percent sign, so the text after it still counts.
    expect(countWords("save 50\\% today").words).toBe(3);
  });

  it("unwraps a command argument (\\textbf{word} -> word)", () => {
    expect(countWords("\\textbf{hello} world").words).toBe(2);
  });

  it("drops bare commands and \\begin/\\end environments", () => {
    const tex = "\\begin{itemize}\\item apple\\end{itemize}";
    expect(countWords(tex).words).toBe(1); // only "apple"
  });

  it("strips math delimiters but keeps the token inside", () => {
    // `$` removed -> "cost is x dollars" -> 4 tokens.
    expect(countWords("cost is $x$ dollars").words).toBe(4);
  });

  it("empty input is zero words, zero chars, one line", () => {
    const r = countWords("");
    expect(r.words).toBe(0);
    expect(r.characters).toBe(0);
    expect(r.lines).toBe(1);
  });
});
