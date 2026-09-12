import { describe, expect, it } from "vitest";
import { ArxivIcon } from "@/components/icons/ArxivIcon";
import { TOOL_DEFINITIONS } from "@/lib/tool-catalog";

describe("tool catalog", () => {
  it("gives every tool a unique id, command name, and slash alias", () => {
    const ids = TOOL_DEFINITIONS.map((tool) => tool.id);
    const commandNames = TOOL_DEFINITIONS.map((tool) => tool.slash[0]);
    const aliases = TOOL_DEFINITIONS.flatMap((tool) => [...tool.slash]);

    expect(new Set(ids).size).toBe(TOOL_DEFINITIONS.length);
    expect(new Set(commandNames).size).toBe(TOOL_DEFINITIONS.length);
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it("keeps the agreed 22 tools in the converter section", () => {
    const converters = TOOL_DEFINITIONS.filter((tool) => tool.category === "Converters");
    expect(converters.map((tool) => tool.id)).toEqual([
      "image-to-latex",
      "pdf-to-latex",
      "visual-typst-editor",
      "arxiv-to-latex",
      "equation-to-latex",
      "excel-to-latex",
      "html-to-latex",
      "image-to-typst",
      "latex-to-html",
      "latex-to-image",
      "latex-to-markdown",
      "latex-to-typst",
      "latex-to-word",
      "markdown-to-latex",
      "markdown-to-typst",
      "mermaid-to-latex",
      "pdf-to-markdown",
      "pdf-to-typst",
      "table-to-latex",
      "typst-editor",
      "typst-to-latex",
      "word-to-latex",
    ]);
  });

  it("keeps the requested citation and PDF commands available", () => {
    expect(
      TOOL_DEFINITIONS.find((tool) => tool.id === "literature-search")?.slash,
    ).toContain("citations-search");
    expect(
      TOOL_DEFINITIONS.find((tool) => tool.id === "pdf-to-latex")?.slash,
    ).toContain("pdf-to-latex");
  });

  it("uses the recognizable arXiv mark for the source converter", () => {
    expect(TOOL_DEFINITIONS.find((tool) => tool.id === "arxiv-to-latex")?.icon).toBe(
      ArxivIcon,
    );
  });
});
