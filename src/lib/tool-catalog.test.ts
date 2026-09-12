import { describe, expect, it } from "vitest";
import { ArxivIcon } from "@/components/icons/ArxivIcon";
import enResearchTools from "@/i18n/locales/en/researchTools.json" with { type: "json" };
import {
  TOOL_CATEGORY_ORDER,
  TOOL_DEFINITIONS,
  toolById,
  toolCategoryLabel,
  toolDescription,
  toolName,
  toolTags,
  type ToolId,
} from "./tool-catalog";

const CATALOG_IDS: readonly ToolId[] = TOOL_DEFINITIONS.map((tool) => tool.id);

describe("tool catalog identity", () => {
  it("gives every tool a unique id, command name, and slash alias", () => {
    const commandNames = TOOL_DEFINITIONS.map((tool) => tool.slash[0]);
    const aliases = TOOL_DEFINITIONS.flatMap((tool) => [...tool.slash]);

    expect(new Set(CATALOG_IDS).size).toBe(TOOL_DEFINITIONS.length);
    expect(new Set(commandNames).size).toBe(TOOL_DEFINITIONS.length);
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it("keeps the requested citation and PDF commands available", () => {
    expect(
      TOOL_DEFINITIONS.find((tool) => tool.id === "literature-search")?.slash,
    ).toContain("find-citations");
    expect(
      TOOL_DEFINITIONS.find((tool) => tool.id === "pdf-to-latex")?.slash,
    ).toContain("pdf-to-latex");
  });

  it("keeps the agreed 22 tools in the converter section", () => {
    const converters = TOOL_DEFINITIONS.filter((tool) => tool.category === "converters");
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

  it("keeps all eight ad hoc reference tools together", () => {
    expect(
      TOOL_DEFINITIONS.filter((tool) => tool.destination.kind === "reference").map(
        (tool) => tool.id,
      ),
    ).toEqual([
      "arxiv-citation-generator",
      "bibliography-generator",
      "citation-generator",
      "citation-styles",
      "doi-to-bibtex",
      "isbn-to-bibtex",
      "pubmed-to-bibtex",
      "url-to-bibtex",
    ]);
  });

  it("uses the recognizable arXiv mark for the source converter", () => {
    expect(TOOL_DEFINITIONS.find((tool) => tool.id === "arxiv-to-latex")?.icon).toBe(
      ArxivIcon,
    );
  });
});

describe("localized tool catalog copy", () => {
  it("resolves a name, description, and tags for every card and tool-page alias", () => {
    for (const id of [...CATALOG_IDS, "equation", "table"] as const) {
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

  it("reads localized entries from the English catalog", () => {
    expect(toolName("pdf-to-latex")).toBe(enResearchTools.tools.pdfToLatex.name);
    expect(toolName("literature-search")).toBe(
      enResearchTools.tools.literatureSearch.name,
    );
    expect(toolDescription("equation")).toBe(
      enResearchTools.tools.equation.description,
    );
    expect(toolTags("lab-search")).toEqual([
      enResearchTools.tools.labSearch.tagRecords,
      enResearchTools.tools.labSearch.tagCountryFilter,
      enResearchTools.tools.labSearch.tagRor,
    ]);
  });

  it("labels every category and keeps the gallery order complete", () => {
    expect(TOOL_CATEGORY_ORDER.map((category) => toolCategoryLabel(category))).toEqual([
      enResearchTools.tools.category.converters,
      enResearchTools.tools.category.validate,
      enResearchTools.tools.category.research,
      enResearchTools.tools.category.references,
      enResearchTools.tools.category.statistics,
      enResearchTools.tools.category.write,
    ]);
    for (const tool of TOOL_DEFINITIONS) {
      expect(TOOL_CATEGORY_ORDER).toContain(tool.category);
    }
  });

  it("looks every card up by id and rejects an unknown id", () => {
    for (const id of CATALOG_IDS) {
      expect(toolById(id).id).toBe(id);
    }
    expect(() => toolById("nope" as ToolId)).toThrow();
  });
});
