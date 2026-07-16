import { describe, expect, it } from "vitest";
import {
  buildStandaloneDoc,
  modelSupportsVision,
  normalizeFigureCode,
  slugifyFigureName,
} from "./ai-figure";

describe("buildStandaloneDoc", () => {
  it("always includes tikz and wraps the code in a document", () => {
    const out = buildStandaloneDoc({ code: "\\draw (0,0)--(1,1);" });
    expect(out).toContain("\\documentclass[tikz,border=4pt]{standalone}");
    expect(out).toContain("\\usepackage{tikz}");
    expect(out).toContain("\\begin{document}");
    expect(out).toContain("\\begin{tikzpicture}\n\\draw (0,0)--(1,1);\n\\end{tikzpicture}");
    expect(out).toContain("\\draw (0,0)--(1,1);");
    expect(out).toContain("\\end{document}");
  });

  it("does not double-wrap a complete tikzpicture", () => {
    const code = "\\begin{tikzpicture}\n\\fill[blue] (0,0) circle (1);\n\\end{tikzpicture}";
    const out = buildStandaloneDoc({ code });
    expect(out.match(/\\begin\{tikzpicture\}/g)).toHaveLength(1);
    expect(out.match(/\\end\{tikzpicture\}/g)).toHaveLength(1);
  });

  it("normalizes bare commands for document insertion", () => {
    expect(normalizeFigureCode("\\fill[blue] (0,0) circle (1);"))
      .toBe("\\begin{tikzpicture}\n\\fill[blue] (0,0) circle (1);\n\\end{tikzpicture}");
  });

  it("adds requested packages and libraries without duplicating tikz", () => {
    const out = buildStandaloneDoc({
      code: "x",
      packages: ["tikz", "amsmath"],
      libraries: ["arrows.meta", "positioning"],
    });
    expect(out.match(/\\usepackage\{tikz\}/g)?.length).toBe(1);
    expect(out).toContain("\\usepackage{amsmath}");
    expect(out).toContain("\\usetikzlibrary{arrows.meta,positioning}");
  });
});

describe("modelSupportsVision", () => {
  it("recognizes known vision models", () => {
    expect(modelSupportsVision("openai", "gpt-4o")).toBe(true);
    expect(modelSupportsVision("openai", "gpt-4.1-mini")).toBe(true);
    expect(modelSupportsVision("anthropic", "claude-3-5-sonnet-20241022")).toBe(true);
    expect(modelSupportsVision("anthropic", "claude-sonnet-4-20250514")).toBe(true);
    expect(modelSupportsVision("openrouter", "google/gemini-flash-1.5")).toBe(true);
    expect(modelSupportsVision("ollama", "llama3.2-vision")).toBe(true);
  });

  it("defaults unknown / text-only models to false", () => {
    expect(modelSupportsVision("openai", "o3-mini")).toBe(false);
    expect(modelSupportsVision("groq", "llama-3.3-70b-versatile")).toBe(false);
    expect(modelSupportsVision("deepseek", "deepseek-chat")).toBe(false);
    expect(modelSupportsVision("ollama", "qwen2.5")).toBe(false);
  });
});

describe("slugifyFigureName", () => {
  it("produces a safe filename stem", () => {
    expect(slugifyFigureName("Transformer Encoder (6 blocks)!")).toBe(
      "transformer-encoder-6-blocks",
    );
    expect(slugifyFigureName("")).toBe("figure");
    expect(slugifyFigureName("   ")).toBe("figure");
  });
});
