import { describe, expect, it } from "vitest";
import enNotes from "@/i18n/locales/en/notes.json" with { type: "json" };
import { blockSyntax, noteBlockGuide } from "./block-guide";
import { BUILT_IN_BLOCKS } from "./block-views";
import "./tests/setup";

describe("noteBlockGuide", () => {
  const guide = noteBlockGuide();

  it("names the fence of every block kind and alias", () => {
    for (const kind of BUILT_IN_BLOCKS) {
      expect(guide).toContain(`\`\`\`${kind.name}`);
      for (const alias of kind.aliases ?? []) expect(guide).toMatch(new RegExp(`\\b${alias}\\b`, "u"));
    }
  });

  it.each(BUILT_IN_BLOCKS.map((kind) => kind.name))("has short syntax help in the interface language for %s", (name) => {
    const syntax = blockSyntax(name);
    const [before, after] = enNotes.blocks.syntax[name as keyof typeof enNotes.blocks.syntax].split("{{example}}");
    expect(syntax?.startsWith(before)).toBe(true);
    expect(syntax?.endsWith(after ?? "")).toBe(true);
    expect(syntax).not.toContain("{{");
    expect(syntax?.split("\n").length).toBeLessThanOrEqual(3);
    expect(blockSyntax("python")).toBeNull();
  });

  it("fills in the TikZ examples, which need semicolons the catalogs can't hold", () => {
    expect(blockSyntax("tikz")).toContain("\\draw (0,0) -- (2,1) node[right] {A};");
    expect(blockSyntax("circuitikz")).toContain("\\draw (0,0) to[R, l=$R_1$] (2,0);");
  });

  it("is compact enough for a system prompt and has no unfilled placeholders", () => {
    expect(guide.length).toBeLessThan(8000);
    expect(guide).not.toContain("${");
    expect(guide).toContain("\\ce{H2O}");
    expect(guide.split("\n\n").length).toBeGreaterThan(10);
  });
});
