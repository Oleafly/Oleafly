import { describe, expect, it } from "vitest";
import { linkTargetAt } from "./link-follow";

function at(text: string): [string, number] {
  const offset = text.indexOf("|");
  return [text.slice(0, offset) + text.slice(offset + 1), offset];
}

describe("the file link under a Cmd+click", () => {
  it("reads a LaTeX \\href from its path or its text", () => {
    expect(linkTargetAt(...at(String.raw`Code: \href{analysis/run.py}{the s|cript}.`))).toBe("analysis/run.py");
    expect(linkTargetAt(...at(String.raw`Code: \href{analy|sis/run.py}{script}`))).toBe("analysis/run.py");
    expect(linkTargetAt(...at(String.raw`\href{data/a\_b\%20c.csv}{d|ata}`))).toBe("data/a_b%20c.csv");
  });

  it("reads Typst and Markdown links, angle brackets included", () => {
    expect(linkTargetAt(...at('See #link("notes/plan.md")[the p|lan].'))).toBe("notes/plan.md");
    expect(linkTargetAt(...at("See [the p|lan](notes/plan.md)."))).toBe("notes/plan.md");
    expect(linkTargetAt(...at("See [land](<Сведения о у|частке.md>)."))).toBe("Сведения о участке.md");
  });

  it("finds nothing outside a link", () => {
    expect(linkTargetAt(...at(String.raw`Co|de: \href{analysis/run.py}{script}`))).toBeNull();
    expect(linkTargetAt(...at("plain te|xt"))).toBeNull();
    expect(linkTargetAt(...at(String.raw`\ref{fig:a|}`))).toBeNull();
  });
});
