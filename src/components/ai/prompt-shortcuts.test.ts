import { describe, expect, it } from "vitest";
import enAi from "@/i18n/locales/en/ai.json" with { type: "json" };
import { promptCategories } from "./prompt-shortcuts";

function shortcut(profile: string | undefined, id: string) {
  const item = promptCategories(profile)
    .flatMap((category) => category.items)
    .find((entry) => entry.id === id);
  if (!item) throw new Error(`missing ${id}`);
  return item;
}

describe("prompt shortcuts", () => {
  it("keeps the LaTeX wording by default", () => {
    expect(shortcut(undefined, "fix-latex-errors").prompt).toBe(
      "Find and fix any LaTeX errors or compile issues in this document.",
    );
    expect(shortcut("latex", "tikz-figure").label).toBe(enAi.shortcuts.tikzFigure.label);
    expect(shortcut("latex", "generate-table").prompt).toBe("Draft a LaTeX table for: ");
  });

  it("speaks Typst in a Typst project", () => {
    const fix = shortcut("typst", "fix-latex-errors");
    const equation = shortcut("typst", "write-equation");
    const table = shortcut("typst", "generate-table");
    const figure = shortcut("typst", "tikz-figure");

    expect(fix.label).toBe(enAi.shortcuts.typstVariants.fixErrors.label);
    expect(fix.prompt).toBe("Find and fix any Typst errors or compile issues in this document.");
    expect(equation.description).toBe(enAi.shortcuts.typstVariants.writeEquation.description);
    expect(equation.prompt).toBe("Write a Typst math equation for: ");
    expect(table.description).toBe(enAi.shortcuts.typstVariants.generateTable.description);
    expect(table.prompt).toBe("Draft a Typst table for: ");
    expect(figure.label).toBe(enAi.shortcuts.typstVariants.figure.label);
    expect(figure.description).toBe(enAi.shortcuts.typstVariants.figure.description);
    expect(figure.prompt).toBe("Draft a CeTZ figure for: ");
    expect(shortcut("typst", "academic-presentation").prompt).toBe(
      "Turn this paper into a Typst slide presentation.",
    );
  });

  it("leaves no LaTeX or TikZ wording in a Typst project's prompts", () => {
    const text = promptCategories("typst")
      .flatMap((category) => category.items)
      .map((item) => `${item.label} ${item.description} ${item.prompt}`)
      .join("\n");

    expect(text).not.toMatch(/LaTeX|TikZ|Beamer/);
  });
});
