import type { DiagramModel } from "@oleafly/latex";
import { afterEach, describe, expect, it, vi } from "vitest";
import { convertLabel, convertModel, convertModelLabels } from "./convert";
import type { DiagramLanguageId } from "./types";

const upper = (latex: string) => latex.toUpperCase();

function model(labels: string[], edgeLabels: (string | undefined)[] = []): DiagramModel {
  return {
    version: 1,
    nodes: labels.map((label, index) => ({ id: `n${index}`, shape: "text", x: 0, y: 0, w: 80, h: 40, label })),
    edges: edgeLabels.map((label, index) => ({
      id: `e${index}`,
      source: "n0",
      target: "n1",
      routing: "straight",
      arrow: "forward",
      style: "solid",
      ...(label === undefined ? {} : { label }),
    })),
  };
}

describe("convertLabel", () => {
  it.each<[string, DiagramLanguageId, DiagramLanguageId, string]>([
    ["$x^2$", "tikz", "mermaid", "$$x^2$$"],
    ["$$x^2$$", "mermaid", "tikz", "$x^2$"],
    ["$a + b$", "typst", "tikz", "$a + b$"],
    ["$a + b$", "tikz", "typst", "$A + B$"],
    ["$$a$$", "mermaid", "typst", "$A$"],
    ["$a$", "typst", "mermaid", "$$a$$"],
    [String.raw`\texttt{print(x)}`, "tikz", "typst", "`print(x)`"],
    ["`print(x)`", "typst", "tikz", String.raw`\texttt{print(x)}`],
    [String.raw`\texttt{print(x)}`, "tikz", "mermaid", "print(x)"],
    ["`print(x)`", "typst", "mermaid", "print(x)"],
    ["print(x)", "mermaid", "tikz", "print(x)"],
    ["Plain label", "tikz", "typst", "Plain label"],
    ["$$x$$", "tikz", "typst", "$$x$$"],
    [String.raw`\texttt{a{b}}`, "tikz", "typst", String.raw`\texttt{a{b}}`],
  ])("rewrites %j from %s to %s as %j", (label, from, to, expected) => {
    expect(convertLabel(label, from, to, upper)).toBe(expected);
  });

  it("keeps the LaTeX math body when no Typst converter is available", () => {
    expect(convertLabel(String.raw`$\alpha$`, "tikz", "typst", null)).toBe(String.raw`$\alpha$`);
  });

  it("returns the label untouched when the language does not change", () => {
    expect(convertLabel("$x$", "typst", "typst", upper)).toBe("$x$");
  });
});

describe("convertModelLabels", () => {
  it("returns the same model when the language does not change", () => {
    const original = model(["$x$"]);
    expect(convertModelLabels(original, "tikz", "tikz", upper)).toBe(original);
  });

  it("rewrites node and edge labels and leaves unlabeled edges alone", () => {
    const original = model(["$x$", String.raw`\texttt{f}`], ["$y$", undefined]);
    const converted = convertModelLabels(original, "tikz", "mermaid", null);
    expect(converted.nodes.map((node) => node.label)).toEqual(["$$x$$", "f"]);
    expect(converted.edges[0].label).toBe("$$y$$");
    expect(converted.edges[1]).toBe(original.edges[1]);
    expect(original.nodes[0].label).toBe("$x$");
  });
});

describe("convertModel", () => {
  afterEach(() => {
    vi.doUnmock("@oleafly/editor/latex-to-typst-math");
    vi.resetModules();
  });

  it("returns the same model when the language does not change", async () => {
    const original = model(["$x$"]);
    await expect(convertModel(original, "typst", "typst")).resolves.toBe(original);
  });

  it("translates LaTeX math into Typst math when moving to Typst", async () => {
    const converted = await convertModel(model([String.raw`$\alpha^2 + \frac{a}{b}$`]), "tikz", "typst");
    expect(converted.nodes[0].label).toBe("$alpha^2 + frac(a, b)$");
  });

  it("only rewrites delimiters when moving away from Typst", async () => {
    const converted = await convertModel(model(["$alpha$", "`x`"]), "typst", "mermaid");
    expect(converted.nodes.map((node) => node.label)).toEqual(["$$alpha$$", "x"]);
  });

  it("falls back to the LaTeX body when the math converter fails to load", async () => {
    vi.doMock("@oleafly/editor/latex-to-typst-math", () => {
      throw new Error("chunk failed to load");
    });
    vi.resetModules();
    const fresh = await import("./convert");
    const converted = await fresh.convertModel(model([String.raw`$$\alpha$$`]), "mermaid", "typst");
    expect(converted.nodes[0].label).toBe(String.raw`$\alpha$`);
  });
});
