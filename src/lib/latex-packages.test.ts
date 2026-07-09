import { describe, it, expect } from "vitest";
import { LATEX_PACKAGES, taggingStatus, packagesThatBreakTagging } from "./latex-packages";

describe("LATEX_PACKAGES catalog", () => {
  it("has unique names and complete fields", () => {
    const names = new Set<string>();
    for (const p of LATEX_PACKAGES) {
      expect(p.name).toBeTruthy();
      expect(p.description).toBeTruthy();
      expect(["all", "pdf"]).toContain(p.scope);
      expect(["ok", "caution", "breaks"]).toContain(p.tagging);
      expect(typeof p.defaultOn).toBe("boolean");
      expect(names.has(p.name)).toBe(false);
      names.add(p.name);
    }
  });

  it("includes unicode-math (required for tagged math export)", () => {
    expect(LATEX_PACKAGES.some((p) => p.name === "unicode-math")).toBe(true);
  });

  it("marks listings as breaking tagging", () => {
    expect(LATEX_PACKAGES.find((p) => p.name === "listings")?.tagging).toBe("breaks");
  });

  it("marks caption and tikz as tagging cautions", () => {
    expect(LATEX_PACKAGES.find((p) => p.name === "caption")?.tagging).toBe("caution");
    expect(LATEX_PACKAGES.find((p) => p.name === "tikz")?.tagging).toBe("caution");
  });

  it("does not default-enable inputenc (obsolete on Xe/LuaLaTeX) or lipsum (filler)", () => {
    expect(LATEX_PACKAGES.find((p) => p.name === "inputenc")?.defaultOn).toBe(false);
    expect(LATEX_PACKAGES.find((p) => p.name === "lipsum")?.defaultOn).toBe(false);
  });
});

describe("helpers", () => {
  it("taggingStatus returns the catalog status, defaulting to ok", () => {
    expect(taggingStatus("listings")).toBe("breaks");
    expect(taggingStatus("amsmath")).toBe("ok");
    expect(taggingStatus("some-unknown-pkg")).toBe("ok");
  });

  it("packagesThatBreakTagging lists the incompatible ones (for the preflight denylist)", () => {
    expect(packagesThatBreakTagging()).toContain("listings");
  });
});
