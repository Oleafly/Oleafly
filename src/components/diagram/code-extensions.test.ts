import { describe, expect, it } from "vitest";
import { recompileShortcutGuard } from "@/components/editor/cm/recompile-shortcut";
import { diagramCodeExtensions, diagramLanguageExtensions } from "./code-extensions";

describe("diagram editor extensions", () => {
  it("guards the recompile shortcut in every diagram language", () => {
    const languages = diagramLanguageExtensions();

    expect(Object.keys(languages).sort()).toEqual(["mermaid", "tikz", "typst"]);
    for (const extensions of Object.values(languages)) {
      expect(extensions).toContain(recompileShortcutGuard);
    }
  });

  it("gives TikZ the same extensions as the standalone code editor", () => {
    const tikz = diagramLanguageExtensions().tikz;
    const code = diagramCodeExtensions();

    expect(tikz).toHaveLength(code.length);
    expect(tikz.at(-1)).toBe(code.at(-1));
    expect(diagramLanguageExtensions().mermaid).toHaveLength(2);
  });
});
