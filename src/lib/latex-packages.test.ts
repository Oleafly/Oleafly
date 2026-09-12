import { describe, it, expect } from "vitest";
import { packageTaggingStatus } from "@oleafly/preflight";
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

  it("marks the packages the LaTeX Project lists as incompatible", () => {
    for (const name of [
      "listings",
      "float",
      "caption",
      "subcaption",
      "algorithm2e",
      "minted",
      "titlesec",
      "wrapfig",
      "lineno",
      "authblk",
      "todonotes",
      "threeparttable",
      "pdfpages",
      "subfig",
      "multirow",
    ]) {
      expect(LATEX_PACKAGES.find((p) => p.name === name)?.tagging, name).toBe("breaks");
    }
  });

  it("marks enumitem as breaking, because a tagged build cannot load it", () => {
    expect(LATEX_PACKAGES.find((p) => p.name === "enumitem")?.tagging).toBe("breaks");
  });

  it("marks partially compatible packages as a caution", () => {
    for (const name of ["hyperref", "tikz", "amsmath", "biblatex", "siunitx", "cleveref"]) {
      expect(LATEX_PACKAGES.find((p) => p.name === name)?.tagging, name).toBe("caution");
    }
  });

  it("cautions on a package upstream has not checked yet", () => {
    expect(packageTaggingStatus("babel").status).toBe("unchecked");
    expect(LATEX_PACKAGES.find((p) => p.name === "babel")?.tagging).toBe("caution");
  });

  it("leaves the packages upstream calls compatible alone", () => {
    for (const name of ["graphicx", "booktabs", "xcolor", "natbib", "fontspec", "url"]) {
      expect(LATEX_PACKAGES.find((p) => p.name === name)?.tagging, name).toBe("ok");
    }
  });

  it("never disagrees with the vendored LaTeX Project data except where it is stricter", () => {
    for (const p of LATEX_PACKAGES) {
      const official = packageTaggingStatus(p.name).status;
      if (p.tagging === "ok") expect(official, p.name).toBe("compatible");
      if (p.tagging === "caution") {
        expect(["partially-compatible", "unchecked", "unknown"], p.name).toContain(official);
      }
      if (p.tagging === "breaks") {
        expect(["currently-incompatible", "no-support", "partially-compatible"], p.name).toContain(official);
      }
    }
  });

  it("does not default-enable inputenc (obsolete on Xe/LuaLaTeX) or lipsum (filler)", () => {
    expect(LATEX_PACKAGES.find((p) => p.name === "inputenc")?.defaultOn).toBe(false);
    expect(LATEX_PACKAGES.find((p) => p.name === "lipsum")?.defaultOn).toBe(false);
  });
});

describe("helpers", () => {
  it("taggingStatus returns the catalog status and falls back to the official data", () => {
    expect(taggingStatus("listings")).toBe("breaks");
    expect(taggingStatus("graphicx")).toBe("ok");
    expect(taggingStatus("some-unknown-pkg")).toBe("caution");
    expect(taggingStatus("adjustbox")).toBe("breaks");
  });

  it("packagesThatBreakTagging lists the incompatible ones (for the preflight denylist)", () => {
    expect(packagesThatBreakTagging()).toContain("listings");
    expect(packagesThatBreakTagging()).toContain("float");
  });
});
