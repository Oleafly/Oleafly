import { describe, expect, it } from "vitest";
import { highlight } from "./highlight";
import { query } from "./testing";

function paint(source: string): string {
  const analyzed = query(source);
  return highlight(source, analyzed.tokens, analyzed.diagnostics)
    .map((segment) => `${segment.kind}${segment.error ? "!" : ""}[${source.slice(segment.start, segment.end)}]`)
    .join(" ");
}

describe("highlight", () => {
  it("covers every character in order", () => {
    const source = '-engine:typst,md (draft OR "lab notes") AND NOT x';
    const analyzed = query(source);
    const segments = highlight(source, analyzed.tokens, analyzed.diagnostics);
    expect(segments.map((segment) => source.slice(segment.start, segment.end)).join("")).toBe(source);
    expect(segments.every((segment, index) => index === 0 || segments[index - 1].end === segment.start)).toBe(true);
  });

  it("marks keys, values, operators and phrases", () => {
    expect(paint('-engine:typst,md (a OR "b c")')).toBe(
      'negation[-] key[engine:] value[typst] text[,] value[md] text[ ] paren[(] text[a] text[ ] operator[OR] text[ ] phrase["b c"] paren[)]',
    );
    expect(paint("NOT a")).toBe("negation[NOT] text[ ] text[a]");
  });

  it("flags unknown keys, bad values and syntax problems", () => {
    expect(paint("colour:red")).toBe("key![colour:] text[red]");
    expect(paint("engine:banana,typst")).toBe("key[engine:] value![banana] text[,] value[typst]");
    expect(paint("engine:")).toBe("key![engine:]");
    expect(paint("a OR")).toBe("text[a] text[ ] operator![OR]");
  });

  it("works without diagnostics", () => {
    const analyzed = query("a");
    expect(highlight("a", analyzed.tokens)).toEqual([{ start: 0, end: 1, kind: "text", error: false }]);
  });
});
