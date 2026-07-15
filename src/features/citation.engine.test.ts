import { describe, expect, it } from "vitest";
import { ensureTypstBibliography } from "./citation";

describe("Typst bibliography wiring", () => {
  it("adds the official bibliography declaration exactly once", () => {
    const once = ensureTypstBibliography("= Paper\n", "references.bib");
    expect(once).toContain('#bibliography("references.bib")');
    expect(ensureTypstBibliography(once, "other.bib")).toBe(once);
  });
});
