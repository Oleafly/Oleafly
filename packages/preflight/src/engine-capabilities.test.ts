import { describe, expect, it } from "vitest";
import { runPreflight } from "./engine";

describe("engine-aware preflight", () => {
  it("does not apply LaTeX source rules to unsupported source profiles", () => {
    const latexLikeText = "\\includegraphics{missing.png}";
    expect(runPreflight({ source: latexLikeText }).findings.length).toBeGreaterThan(0);
    expect(runPreflight({ source: latexLikeText, sourceProfile: "none" }).findings).toEqual([]);
    expect(runPreflight({ source: latexLikeText, sourceProfile: "none" }).refsScore).toBeNull();
  });

  it("keeps output checks shared when source checks are unavailable", () => {
    const report = runPreflight({
      source: "# Typst or Markdown source",
      sourceProfile: "none",
      pages: [[{ str: "Hello", x: 10, y: 10, width: 20 }]],
      readerText: "Hello",
      meta: { lang: null, title: null, tagged: false },
    });
    expect(report.hasPdf).toBe(true);
    expect(report.coverage.ats).toBe("evaluated");
    expect(report.findings.some((finding) => finding.id.startsWith("pdf-"))).toBe(true);
  });
});
