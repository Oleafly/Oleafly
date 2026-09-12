import { describe, expect, it } from "vitest";
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import {
  TOOL_CATEGORY_ORDER,
  TOOL_DEFINITIONS,
  toolById,
  toolCategoryLabel,
  toolDescription,
  toolName,
  toolTags,
  type ToolCategory,
  type ToolId,
} from "./tool-catalog";

const CATALOG_IDS: readonly ToolId[] = TOOL_DEFINITIONS.map((tool) => tool.id);

const LOCALIZED_IDS: readonly ToolId[] = [
  "pdf-to-latex",
  "equation",
  "bibtex",
  "table",
  "literature-search",
  "lab-search",
  "deadlines",
];

const CATEGORY_KEYS: readonly ToolCategory[] = [
  "convert",
  "validate",
  "tables",
  "research",
];

describe("tool catalog identity", () => {
  it("gives every tool a unique id, command name, and slash alias", () => {
    const ids = TOOL_DEFINITIONS.map((tool) => tool.id);
    const commandNames = TOOL_DEFINITIONS.map((tool) => tool.slash[0]);
    const aliases = TOOL_DEFINITIONS.flatMap((tool) => [...tool.slash]);

    expect(new Set(ids).size).toBe(TOOL_DEFINITIONS.length);
    expect(new Set(commandNames).size).toBe(TOOL_DEFINITIONS.length);
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it("keeps the requested citation and PDF commands available", () => {
    expect(
      TOOL_DEFINITIONS.find((tool) => tool.id === "literature-search")?.slash,
    ).toContain("citations-search");
    expect(
      TOOL_DEFINITIONS.find((tool) => tool.id === "pdf-to-latex")?.slash,
    ).toContain("pdf-to-latex");
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
});

describe("tool catalog", () => {
  it("defines every tool exactly once", () => {
    expect(new Set(CATALOG_IDS).size).toBe(TOOL_DEFINITIONS.length);
  });

  it("resolves a name, a description and tags for every tool", () => {
    for (const id of [...CATALOG_IDS, ...LOCALIZED_IDS]) {
      const name = toolName(id);
      const description = toolDescription(id);
      const tags = toolTags(id);
      expect(name.length, `${id} name`).toBeGreaterThan(0);
      expect(description.length, `${id} description`).toBeGreaterThan(0);
      expect(name).not.toContain("researchTools.");
      expect(description).not.toContain("researchTools.");
      expect(tags.length, `${id} tags`).toBeGreaterThan(0);
      for (const tag of tags) {
        expect(tag.length).toBeGreaterThan(0);
        expect(tag).not.toContain("researchTools.");
      }
    }
  });

  it("reads its names from the English catalog", () => {
    expect(toolName("pdf-to-latex")).toBe(enResearchTools.tools.pdfToLatex.name);
    expect(toolName("deadlines")).toBe(enResearchTools.tools.deadlines.name);
    expect(toolDescription("equation")).toBe(enResearchTools.tools.equation.description);
    expect(toolTags("lab-search")).toEqual([
      enResearchTools.tools.labSearch.tagRecords,
      enResearchTools.tools.labSearch.tagCountryFilter,
      enResearchTools.tools.labSearch.tagRor,
    ]);
  });

  it("reads names the conversion matrix added from the definition itself", () => {
    expect(toolName("latex-to-typst")).toBe("LaTeX to Typst");
    expect(toolDescription("stats")).toBe(
      "Calculate p-values, sample sizes, and confidence intervals locally.",
    );
    expect(toolTags("symbols")).toEqual([
      "Greek",
      "Arrows",
      "Cheatsheet",
      "Insert at cursor",
    ]);
  });

  it("labels every localized category and keeps the gallery order complete", () => {
    const labels = CATEGORY_KEYS.map((category) => toolCategoryLabel(category));
    expect(labels).toEqual([
      enResearchTools.tools.category.convert,
      enResearchTools.tools.category.validate,
      enResearchTools.tools.category.tables,
      enResearchTools.tools.category.research,
    ]);
    for (const tool of TOOL_DEFINITIONS) {
      expect(TOOL_CATEGORY_ORDER).toContain(tool.category);
    }
  });

  it("gives every tool a unique slash prefix and a destination", () => {
    const seen = new Set<string>();
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.slash.length).toBeGreaterThan(0);
      for (const slash of tool.slash) {
        expect(seen.has(slash)).toBe(false);
        seen.add(slash);
      }
      expect(tool.destination.kind.length).toBeGreaterThan(0);
      expect(typeof tool.icon).not.toBe("undefined");
    }
  });

  it("looks a tool up by id and rejects an unknown one", () => {
    for (const id of CATALOG_IDS) {
      expect(toolById(id).id).toBe(id);
    }
    expect(() => toolById("nope" as ToolId)).toThrow();
  });
});
