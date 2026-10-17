import { describe, expect, it } from "vitest";
import type { TypstFontEntry } from "@/lib/typst-options";
import {
  fontFamilyName,
  matchingFamilies,
  primaryFontFamily,
  quotedFontFamily,
  sourceKinds,
  withoutControlCharacters,
} from "./font-families";

const FAMILIES: TypstFontEntry[] = [
  { name: "Brand Sans", sources: [{ kind: "project", path: "fonts/Brand.otf" }] },
  { name: "Libertinus Serif", sources: [{ kind: "embedded" }] },
  { name: "Inter", sources: [{ kind: "embedded" }, { kind: "system", path: "/Library/Fonts/Inter.ttf" }] },
] as TypstFontEntry[];

describe("font families", () => {
  it("filters by name and orders sources", () => {
    expect(matchingFamilies(FAMILIES, " libertinus ").map((family) => family.name)).toEqual(["Libertinus Serif"]);
    expect(matchingFamilies(FAMILIES, "")).toHaveLength(3);
    expect(sourceKinds(FAMILIES[2])).toEqual(["system", "embedded"]);
  });
});

describe("primaryFontFamily", () => {
  it("reads the first family of a font stack", () => {
    expect(primaryFontFamily('"JetBrains Mono", ui-monospace, monospace')).toBe("JetBrains Mono");
    expect(primaryFontFamily("Menlo, Monaco, monospace")).toBe("Menlo");
    expect(primaryFontFamily("'iA Writer Mono S', monospace")).toBe("iA Writer Mono S");
    expect(primaryFontFamily(String.raw`"Quote \"Sans\"", serif`)).toBe('Quote "Sans"');
    expect(primaryFontFamily("  Fira   Code  ")).toBe("Fira Code");
  });

  it("treats a generic family or an empty stack as the default font", () => {
    expect(primaryFontFamily("ui-monospace, monospace")).toBe("");
    expect(primaryFontFamily("Monospace")).toBe("");
    expect(primaryFontFamily("")).toBe("");
  });
});

describe("quotedFontFamily", () => {
  it("quotes a family name and escapes quotes and backslashes", () => {
    expect(quotedFontFamily(" iA Writer Duo S ")).toBe('"iA Writer Duo S"');
    expect(quotedFontFamily(String.raw`Odd "Name" \ Mono`)).toBe(String.raw`"Odd \"Name\" \\ Mono"`);
  });

  it("drops control characters and runs of whitespace", () => {
    expect(fontFamilyName("Fira\u0000\tCode\n")).toBe("Fira Code");
    expect(withoutControlCharacters("A\u0007 B ")).toBe("A B ");
  });
});
