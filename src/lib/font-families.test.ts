import { describe, expect, it } from "vitest";
import type { TypstFontEntry } from "@/lib/typst-options";
import { matchingFamilies, sourceKinds } from "./font-families";

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
