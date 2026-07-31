import { afterEach, describe, expect, it, vi } from "vitest";
import { countWords } from "./wordcount";

describe("countWords (masked)", () => {
  it("counts plain words, prose characters, and lines with the masked method", () => {
    const r = countWords("hello world");
    expect(r.words).toBe(2);
    expect(r.characters).toBe(11);
    expect(r.lines).toBe(1);
    expect(r.method).toBe("masked");
  });

  it("counts lines by newline and characters over the compacted prose", () => {
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
    expect(countWords("save 50\\% today words").words).toBe(3);
  });

  it("INTENTIONAL CHANGE: bare numbers are no longer counted as words", () => {
    // The masked counter counts spellcheckable word tokens; "50" is not one.
    // The old heuristic counted "save 50\% today" as 3 words.
    expect(countWords("save 50\\% today").words).toBe(2);
  });

  it("keeps prose inside command arguments (\\textbf{word} -> word)", () => {
    expect(countWords("\\textbf{hello} world").words).toBe(2);
  });

  it("drops bare commands and \\begin/\\end environments", () => {
    const tex = "\\begin{itemize}\\item apple\\end{itemize}";
    expect(countWords(tex).words).toBe(1); // only "apple"
  });

  it("INTENTIONAL CHANGE: inline math bodies are excluded from the count", () => {
    // The old heuristic stripped only the `$` delimiters and counted "x" as a
    // word (4 words). The mask excludes the whole math body: 3 prose words.
    expect(countWords("cost is $x$ dollars").words).toBe(3);
  });

  it("INTENTIONAL CHANGE: math environments are excluded from the count", () => {
    const tex = "\\begin{equation}E = mc^2\\end{equation}\nProse sentence here.";
    const r = countWords(tex);
    expect(r.words).toBe(3);
    expect(r.lines).toBe(1); // the equation-only line is not a content line
  });

  it("INTENTIONAL CHANGE: verbatim bodies are excluded from the count", () => {
    const tex =
      "\\begin{verbatim}not counted code tokens\\end{verbatim}\nReal text.";
    expect(countWords(tex).words).toBe(2);
  });

  it("INTENTIONAL CHANGE: tikz pictures are excluded from the count", () => {
    const tex =
      "\\begin{tikzpicture}\\draw (0,0) node {ignored};\\end{tikzpicture}\nCaption words here.";
    expect(countWords(tex).words).toBe(3);
  });

  it("INTENTIONAL CHANGE: labels, refs, and citation keys are excluded", () => {
    // Old heuristic unwrapped `\ref{sec:intro}` to "sec:intro" and counted it.
    expect(countWords("See \\ref{sec:intro} and \\cite{knuth84}.").words).toBe(2);
  });

  it("empty input is zero words, zero chars, zero lines", () => {
    const r = countWords("");
    expect(r.words).toBe(0);
    expect(r.characters).toBe(0);
    expect(r.lines).toBe(0);
    expect(r.method).toBe("masked");
  });

  it("does not count preamble commands or comment-only lines toward the line count", () => {
    const tex =
      "\\documentclass{article}\n% a comment line\n\\usepackage{geometry}\n\\begin{document}\nActual content here.\n\\end{document}\n";
    const r = countWords(tex);
    expect(r.lines).toBe(1);
    expect(r.words).toBe(3);
  });

  it("characters excludes LaTeX markup and comments, not just the raw string length", () => {
    const tex = "\\textbf{hello} world % trailing comment";
    const r = countWords(tex);
    expect(r.characters).toBe("hello world".length);
  });

  it("blank lines between real content are not counted as lines", () => {
    const tex = "first line\n\n\nsecond line\n";
    const r = countWords(tex);
    expect(r.lines).toBe(2);
  });
});

describe("countWords heuristic fallback", () => {
  afterEach(() => {
    vi.doUnmock("@oleafly/editor");
    vi.resetModules();
  });

  it("falls back to the legacy heuristic when masking throws", async () => {
    vi.resetModules();
    vi.doMock("@oleafly/editor", () => {
      const boom = () => {
        throw new Error("mask exploded");
      };
      return { maskLatex: boom, maskToProse: boom, spellcheckRanges: boom };
    });
    const { countWords: mockedCountWords } = await import("./wordcount");

    const r = mockedCountWords("\\textbf{hello} world");
    expect(r.method).toBe("heuristic");
    expect(r.words).toBe(2);
    expect(r.characters).toBe("hello world".length);
    expect(r.lines).toBe(1);
  });
});
