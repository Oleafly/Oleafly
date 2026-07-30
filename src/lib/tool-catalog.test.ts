import { describe, expect, it } from "vitest";
import { TOOL_DEFINITIONS } from "@/lib/tool-catalog";

describe("tool catalog", () => {
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
