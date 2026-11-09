import { describe, expect, it } from "vitest";
import { noteBlockGuide } from "./block-guide";
import { BUILT_IN_BLOCKS } from "./block-views";

describe("noteBlockGuide", () => {
  const guide = noteBlockGuide();

  it("names the fence of every block kind and alias", () => {
    for (const kind of BUILT_IN_BLOCKS) {
      expect(guide).toContain(`\`\`\`${kind.name}`);
      for (const alias of kind.aliases ?? []) expect(guide).toMatch(new RegExp(`\\b${alias}\\b`, "u"));
    }
  });

  it("is compact enough for a system prompt and has no unfilled placeholders", () => {
    expect(guide.length).toBeLessThan(8000);
    expect(guide).not.toContain("${");
    expect(guide).toContain("\\ce{H2O}");
    expect(guide.split("\n\n").length).toBeGreaterThan(10);
  });
});
