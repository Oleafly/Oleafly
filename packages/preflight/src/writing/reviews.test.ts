import { describe, expect, it } from "vitest";
import type { Finding } from "../types";
import { CVPR_PROJECT, REVIEWS } from "./__fixtures__/cvpr-project";
import {
  DEFAULT_WRITING_SETTINGS,
  isReviewsFile,
  paperPlaces,
  reviewPoints,
  reviewReferences,
  runProjectWritingRules,
  type ProjectWritingFile,
} from "./index";

const context = { settings: DEFAULT_WRITING_SETTINGS, profile: "cvpr" as const, macros: [], mainFile: "main.tex" };

function points(files: readonly ProjectWritingFile[], mainFile = "main.tex"): Finding[] {
  return runProjectWritingRules(files, { ...context, mainFile }).filter((finding) => finding.id === "writing-review-point");
}

function at(finding: Finding | undefined, files: readonly ProjectWritingFile[] = CVPR_PROJECT): string {
  const file = files.find((candidate) => candidate.path === finding?.file);
  return file?.content.slice(finding?.from, finding?.to) ?? "";
}

describe("isReviewsFile", () => {
  it("accepts reviews.md and reviews.txt in any folder and any case", () => {
    expect(isReviewsFile("reviews.md")).toBe(true);
    expect(isReviewsFile("rebuttal/Reviews.TXT")).toBe(true);
    expect(isReviewsFile("rebuttal\\reviews.txt")).toBe(true);
    expect(isReviewsFile("my-reviews.md")).toBe(false);
    expect(isReviewsFile("reviews.tex")).toBe(false);
  });
});

describe("reviewPoints", () => {
  it("stays fast on long runs of whitespace", () => {
    expect(reviewPoints("\t\t".repeat(50_000))).toEqual([]);
    expect(reviewPoints(`# reviewer${"\t".repeat(50_000)}x`)).toEqual([]);
    expect(reviewPoints(`**${"\t".repeat(50_000)}x`)).toEqual([]);
  });

  it("reads numbered points and bullets under reviewer headings", () => {
    expect(reviewPoints(REVIEWS).map((point) => [point.label, point.text])).toEqual([
      ["R1.1", "The gains in Table 2 are small on real scenes."],
      ["R1.2", "Fig. 3 lacks a comparison with dense baselines."],
      ["R1.3", "Eq. (2) mixes two losses without explanation."],
      ["R2.1", "Section 3.1 does not state the training hardware."],
      ["R2.2", "Line 123 has a typo."],
      ["R2.3", "The novelty over prior sparse methods is unclear."],
      ["R2.4", "Table 9 is never discussed."],
    ]);
  });

  it("reads Q, W and R markers, joins wrapped lines and keeps sub-bullets in their point", () => {
    const text = [
      "Q1. How fast is it",
      "   on a laptop?",
      "**W1:** The method",
      "  - needs a GPU",
      "R1.2 Missing citation.",
      "",
      "- a loose bullet with no reviewer",
      "1.5x faster is not a point",
    ].join("\n");
    const parsed = reviewPoints(text);
    expect(parsed.map((point) => [point.label, point.text])).toEqual([
      ["Q1", "How fast is it on a laptop?"],
      ["W1", "The method - needs a GPU"],
      ["R1.2", "Missing citation."],
    ]);
    expect(text.slice(parsed[1].from, parsed[1].to)).toBe("**W1:** The method");
  });

  it("names points after an OpenReview reviewer id and ignores headings that name no reviewer", () => {
    expect(reviewPoints("Reviewer xYz9:\n- Weak baselines.\n- W2 Unclear.").map((point) => point.label)).toEqual([
      "xYz9.1",
      "xYz9.W2",
    ]);
    expect(reviewPoints("## Reviewer comments\n- Weak baselines.")).toEqual([]);
  });
});

describe("reviewReferences", () => {
  it("finds every kind of reference in reading order", () => {
    expect(
      reviewReferences("Tab. 2 and Figure 3, Eq.(4), Equation 5, Sec. 4.2. and §3, line 12, L130 and l. 7, Table 2 again."),
    ).toEqual([
      { kind: "table", number: "2" },
      { kind: "figure", number: "3" },
      { kind: "equation", number: "4" },
      { kind: "equation", number: "5" },
      { kind: "section", number: "4.2" },
      { kind: "section", number: "3" },
      { kind: "line", number: "12" },
      { kind: "line", number: "130" },
      { kind: "line", number: "7" },
    ]);
  });
});

describe("paperPlaces", () => {
  it("stays fast on environments that never close", () => {
    const content = "\\begin{figure} x ".repeat(20_000);
    expect(paperPlaces([{ path: "main.tex", content }], "main.tex")).toEqual([]);
  });

  it("numbers floats, equations and sections in document order through \\input and \\include", () => {
    const places = paperPlaces(CVPR_PROJECT, "main.tex").map((place) => `${place.kind} ${place.number} ${place.file}`);
    expect(places).toEqual([
      "figure 1 main.tex",
      "section 1 sec/intro.tex",
      "section 2 sec/method.tex",
      "section 2.1 sec/method.tex",
      "equation 1 sec/method.tex",
      "equation 2 sec/method.tex",
      "equation 3 sec/method.tex",
      "section 2.2 sec/method.tex",
      "figure 2 sec/method.tex",
      "section 3 sec/experiments.tex",
      "section 3.1 sec/experiments.tex",
      "table 1 sec/experiments.tex",
      "table 2 sec/experiments.tex",
      "section 3.2 sec/experiments.tex",
      "figure 3 sec/experiments.tex",
    ]);
  });

  it("resolves inputs against the main file folder and skips unnumbered material", () => {
    const files = [
      { path: "paper/main.tex", content: "\\input{parts/a.tex}\\appendix\\section{Extra}\\begin{table}\\caption{Late}\\end{table}" },
      {
        path: "paper/parts/a.tex",
        content: [
          "\\begin{comment}\\begin{table}\\caption{Hidden}\\end{table}\\end{comment}",
          "\\begin{figure}\\includegraphics{x}\\end{figure}",
          "\\begin{figure}\\begin{subfigure}\\caption{a}\\end{subfigure}\\caption{Both}\\end{figure}",
          "\\begin{equation}a\\tag{*}\\end{equation}",
          "\\begin{subequations}\\begin{align}a\\\\b\\end{align}\\end{subequations}",
          "\\begin{gather}a\\\\\\begin{aligned}b\\\\c\\end{aligned}\\\\\\end{gather}",
          "\\input{parts/a}",
        ].join("\n"),
      },
    ];
    expect(paperPlaces(files, "paper/main.tex").map((place) => `${place.kind} ${place.number}`)).toEqual([
      "figure 1",
      "equation 1",
      "equation 2",
      "equation 3",
      "table 1",
    ]);
  });
});

describe("writing-review-point", () => {
  it("anchors each referenced point at its table, figure, equation or section", () => {
    const findings = points(CVPR_PROJECT);
    const byLabel = (label: string) =>
      findings.find((finding) => finding.title.params?.n === label && finding.title.key === "rules.writing-review-point.title");
    expect([byLabel("R1.1")?.file, at(byLabel("R1.1"))]).toEqual(["sec/experiments.tex", "\\begin{table*}"]);
    expect([byLabel("R1.2")?.file, at(byLabel("R1.2"))]).toEqual(["sec/experiments.tex", "\\begin{figure*}"]);
    expect([byLabel("R1.3")?.file, at(byLabel("R1.3"))]).toEqual([
      "sec/method.tex",
      "L &= L_{\\text{rgb}} + \\lambda L_{\\text{sparse}},",
    ]);
    expect([byLabel("R2.1")?.file, at(byLabel("R2.1"))]).toEqual(["sec/experiments.tex", "\\subsection{Setup}"]);
    expect(byLabel("R1.1")?.detail).toEqual({
      key: "rules.writing-review-point.detail",
      params: { point: "The gains in Table 2 are small on real scenes." },
    });
  });

  it("keeps unplaced points at their line in the reviews file", () => {
    const unplaced = points(CVPR_PROJECT).filter((finding) => finding.title.key === "rules.writing-review-point.titleUnplaced");
    expect(unplaced.map((finding) => [finding.title.params?.n, finding.file, at(finding), finding.detail.key])).toEqual([
      ["R2.2", "reviews.md", "- Line 123 has a typo.", "rules.writing-review-point.detailLines"],
      ["R2.3", "reviews.md", "- The novelty over prior sparse methods is unclear.", "rules.writing-review-point.detailUnplaced"],
      ["R2.4", "reviews.md", "- Table 9 is never discussed.", "rules.writing-review-point.detailUnplaced"],
    ]);
  });

  it("does nothing without a reviews file and reads reviews.txt too", () => {
    const tex = CVPR_PROJECT.filter((file) => file.path.endsWith(".tex"));
    expect(points(tex)).toEqual([]);
    const txt = points([...tex, { path: "notes/reviews.txt", content: "1. Fig. 2 is blurry." }]);
    expect(txt.map((finding) => [finding.file, at(finding)])).toEqual([["sec/method.tex", "\\begin{figure}"]]);
  });

  it("gives each point and place its own fingerprint", () => {
    const fingerprints = points(CVPR_PROJECT).map((finding) => finding.fingerprint);
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });
});
