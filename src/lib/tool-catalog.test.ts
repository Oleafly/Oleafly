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
  type ToolId,
} from "./tool-catalog";

const TOOL_IDS: readonly ToolId[] = [
  "pdf-to-latex",
  "equation",
  "bibtex",
  "table",
  "literature-search",
  "lab-search",
  "deadlines",
];

describe("tool catalog identity", () => {
  it("gives every tool a unique page, command name, and slash alias", () => {
    const pages = TOOL_DEFINITIONS.map((tool) => tool.page);
    const commandNames = TOOL_DEFINITIONS.map((tool) => tool.slash[0]);
    const aliases = TOOL_DEFINITIONS.flatMap((tool) => [...tool.slash]);

    expect(new Set(pages).size).toBe(TOOL_DEFINITIONS.length);
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
});

describe("tool catalog", () => {
  it("defines every tool exactly once", () => {
    expect(TOOL_DEFINITIONS.map((tool) => tool.id).sort()).toEqual([...TOOL_IDS].sort());
  });

  it("resolves a name, a description and tags for every tool", () => {
    for (const id of TOOL_IDS) {
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

  it("labels every category in the gallery order", () => {
    const labels = TOOL_CATEGORY_ORDER.map((category) => toolCategoryLabel(category));
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

  it("gives every tool a unique slash prefix and a page", () => {
    const seen = new Set<string>();
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.slash.length).toBeGreaterThan(0);
      for (const slash of tool.slash) {
        expect(seen.has(slash)).toBe(false);
        seen.add(slash);
      }
      expect(tool.page.length).toBeGreaterThan(0);
      expect(typeof tool.icon).not.toBe("undefined");
    }
  });

  it("looks a tool up by id and rejects an unknown one", () => {
    for (const id of TOOL_IDS) {
      expect(toolById(id).id).toBe(id);
    }
    expect(() => toolById("nope" as ToolId)).toThrow();
  });
});
