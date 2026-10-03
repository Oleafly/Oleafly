import { describe, expect, it } from "vitest";
import { fencedCode, figureHash, mermaidCodeFence, mermaidFigurePath } from "./mermaid-figure";

describe("Mermaid figure names", () => {
  it("hashes with 64-bit FNV-1a over UTF-8, as the pandoc filter does", () => {
    expect(figureHash("")).toBe("cbf29ce484222325");
    expect(figureHash("flowchart TD\n    A --> B")).toBe("a8a349062462ae46");
    expect(figureHash("ä")).not.toBe(figureHash("a"));
  });

  it("names the figure after the fenced block text", () => {
    expect(mermaidFigurePath("\n\nflowchart TD\n    A --> B\n\n")).toBe("figures/mermaid-a8a349062462ae46.png");
    expect(mermaidFigurePath("flowchart TD\r\n    A --> B")).toBe("figures/mermaid-a8a349062462ae46.png");
  });

  it("drops leading blank lines and every kind of trailing whitespace", () => {
    expect(fencedCode(" \t\n\nA --> B \t\n\u00a0\u2028\r\n")).toBe("A --> B");
    expect(fencedCode("  A\n")).toBe("  A");
    expect(fencedCode(`A${" ".repeat(5000)}x`)).toBe(`A${" ".repeat(5000)}x`);
  });

  it("fences the code with a longer fence than any inside it", () => {
    expect(mermaidCodeFence("flowchart TD\n```\nA")).toBe("````mermaid\nflowchart TD\n```\nA\n````");
  });
});
