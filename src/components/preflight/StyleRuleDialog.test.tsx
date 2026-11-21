import { describe, expect, it } from "vitest";
import { countStyleRuleMatches } from "./StyleRuleDialog";

const doc = (body: string) => `\\documentclass{article}\n\\newcommand{\\data}{dataset}\n\\begin{document}\n${body}\n\\end{document}`;

describe("countStyleRuleMatches", () => {
  it("counts prose matches across files and skips the preamble, math and command arguments", () => {
    const texts = [doc("The dataset is big. $dataset$ \\label{dataset} Datasets differ."), doc("Another dataset.")];
    expect(countStyleRuleMatches(texts, { find: "dataset", wholeWord: true, caseSensitive: true })).toBe(2);
    expect(countStyleRuleMatches(texts, { find: "dataset", wholeWord: false, caseSensitive: false })).toBe(3);
    expect(countStyleRuleMatches(texts, { find: "   ", wholeWord: true, caseSensitive: true })).toBe(0);
  });
});
