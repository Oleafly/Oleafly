import { describe, expect, it } from "vitest";
import {
  STANDARD_THEOREM_ENVIRONMENTS,
  theoremEnvironmentSet,
  theoremEnvironmentsFromPreamble,
} from "./theorem-environments";

describe("theoremEnvironmentsFromPreamble", () => {
  it("collects newtheorem and declaretheorem names in order, ignoring comments", () => {
    const preamble = [
      "\\documentclass{article}",
      "\\newtheorem{theorem}{Theorem}[section]",
      "\\newtheorem*{remark}{Remark}",
      "\\newtheorem{lemma}[theorem]{Lemma}",
      "% \\newtheorem{commented}{X}",
      "\\declaretheorem[style=plain]{prop}",
      "\\declaretheorem{fact}",
      "\\newtheorem {spaced} {Spaced}",
      "\\begin{document}",
    ].join("\n");
    expect(theoremEnvironmentsFromPreamble(preamble)).toEqual([
      "theorem",
      "remark",
      "lemma",
      "spaced",
      "prop",
      "fact",
    ]);
  });

  it("reads a declaretheorem whose options carry a command", () => {
    const preamble = "\\declaretheorem[name=\\textbf{Claim}, style=plain]{claim}\n\\declaretheorem[sibling=claim]{conjecture}";
    expect(theoremEnvironmentsFromPreamble(preamble)).toEqual(["claim", "conjecture"]);
  });

  it("stays linear on an unterminated optional argument repeated many times", () => {
    const preamble = "\\declaretheorem[".repeat(4000);
    const started = performance.now();
    expect(theoremEnvironmentsFromPreamble(preamble)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("drops duplicate and malformed names", () => {
    expect(theoremEnvironmentsFromPreamble("\\newtheorem{a}{A}\\newtheorem{a}{B}\\newtheorem{1bad}{C}")).toEqual(["a"]);
    expect(theoremEnvironmentsFromPreamble("")).toEqual([]);
  });
});

describe("theoremEnvironmentSet", () => {
  it("unions the standard set with extra names", () => {
    const set = theoremEnvironmentSet(["mytheorem"]);
    expect(set.size).toBe(STANDARD_THEOREM_ENVIRONMENTS.length + 1);
    expect(set.has("proof")).toBe(true);
    expect(set.has("mytheorem")).toBe(true);
  });
});
