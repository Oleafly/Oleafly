import { describe, expect, it } from "vitest";
import type { Finding } from "../types";
import { CVPR_PROJECT, INTRO, REBUTTAL } from "./__fixtures__/cvpr-project";
import {
  DEFAULT_WRITING_SETTINGS,
  collectLabels,
  proseView,
  runProjectWritingRules,
  splitSentences,
  trimQuote,
  type ProjectWritingFile,
} from "./index";

const context = { settings: DEFAULT_WRITING_SETTINGS, profile: "cvpr" as const, macros: [], mainFile: "main.tex" };

function promises(files: readonly ProjectWritingFile[]): Finding[] {
  return runProjectWritingRules(files, context).filter((finding) => finding.id === "writing-open-promise");
}

function matched(finding: Finding, files: readonly ProjectWritingFile[] = CVPR_PROJECT): string {
  const file = files.find((candidate) => candidate.path === finding.file);
  return file?.content.slice(finding.from, finding.to) ?? "";
}

function sentences(text: string): string[] {
  const view = proseView(text);
  return splitSentences(view).map((span) => text.slice(span.from, span.to));
}

describe("splitSentences", () => {
  it("splits at sentence ends and keeps abbreviations and references inside", () => {
    expect(
      sentences(String.raw`See Fig.~\ref{fig:a} and Tab. 2 for details. Smith et al. agree, e.g. on speed! Is it fast? Yes.`),
    ).toEqual([String.raw`See Fig.~\ref{fig:a} and Tab. 2 for details.`, "Smith et al. agree, e.g. on speed!", "Is it fast?", "Yes."]);
  });

  it("breaks at blank lines and structural commands but not at comment lines", () => {
    const text = "\\begin{document}\nFirst part\n% note\ngoes on\n\nSecond part\n\\begin{itemize}\n\\item One item\n\\end{itemize}\n\\end{document}";
    expect(sentences(text)).toEqual(["First part\n% note\ngoes on", "Second part", "One item"]);
  });

  it("ignores periods in math and command arguments", () => {
    expect(sentences(String.raw`We set $x = 1.5. Y$ and \ref{sec. A} here. Done.`)).toEqual([
      String.raw`We set $x = 1.5. Y$ and \ref{sec. A} here.`,
      "Done.",
    ]);
  });
});

describe("collectLabels", () => {
  it("collects labels from every LaTeX file and skips comments and other files", () => {
    const labels = collectLabels([
      { path: "main.tex", content: "\\label{sec:a} % \\label{sec:hidden}" },
      { path: "supp.tex", content: "\\label{ sec:b }" },
      { path: "reviews.md", content: "\\label{sec:c}" },
    ]);
    expect([...labels].sort()).toEqual(["sec:a", "sec:b"]);
  });
});

describe("trimQuote", () => {
  it("collapses whitespace and trims long sentences at a word with an ellipsis", () => {
    expect(trimQuote("We  will\n add it.")).toBe("We will add it.");
    const long = trimQuote(`We will add ${"many more results ".repeat(12)}later.`);
    expect(long.length).toBeLessThanOrEqual(143);
    expect(long.endsWith("...")).toBe(true);
    expect(long).not.toMatch(/\s\.\.\.$/);
  });
});

describe("writing-open-promise", () => {
  it("flags open promises across the project and keeps the ones a reference or link covers", () => {
    const found = promises(CVPR_PROJECT).map((finding) => `${finding.file}: ${matched(finding)}`);
    expect(found.sort()).toEqual([
      "rebuttal.tex: We will add",
      "sec/experiments.tex: We will release",
      "sec/intro.tex: See the supplementary",
      "sec/intro.tex: in the supplementary material",
      "supp.tex: We will release",
    ]);
  });

  it("uses the rebuttal title in rebuttal files and the plain title elsewhere", () => {
    const findings = promises(CVPR_PROJECT);
    const rebuttal = findings.find((finding) => finding.file === "rebuttal.tex");
    expect(rebuttal?.title).toEqual({ key: "rules.writing-open-promise.titleRebuttal" });
    expect(rebuttal?.detail).toEqual({
      key: "rules.writing-open-promise.detailRebuttal",
      params: { sentence: "We will add the ablation on $\\lambda$ in the final version." },
    });
    const intro = findings.find((finding) => finding.file === "sec/intro.tex");
    expect(intro?.title).toEqual({ key: "rules.writing-open-promise.title" });
    expect(intro).toMatchObject({ lens: "writing", severity: "info" });
  });

  it("treats a reference to a missing label as open", () => {
    const findings = promises([{ path: "sec/intro.tex", content: INTRO }]);
    expect(findings.map((finding) => matched(finding, [{ path: "sec/intro.tex", content: INTRO }]))).toEqual([
      "in the supplementary material",
      "in Appendix",
      "See the supplementary",
    ]);
  });

  it("does not flag pointers in a rebuttal or in the supplementary itself", () => {
    const files = [
      { path: "rebuttal.tex", content: REBUTTAL },
      { path: "supp/appendix.tex", content: "In this supplementary material, see the appendix for proofs." },
    ];
    expect(promises(files).map((finding) => matched(finding, files))).toEqual(["We will add", "We will include"]);
  });

  it("keeps a release promise with a link but not other promises", () => {
    const files = [
      {
        path: "main.tex",
        content: String.raw`Our code will be made publicly available at \url{https://oleafly.edu/x}. We will clarify this in the camera-ready version, see \url{https://oleafly.edu/y}.`,
      },
    ];
    expect(promises(files).map((finding) => matched(finding, files))).toEqual(["We will clarify"]);
  });

  it("skips promises in headings, comments and math", () => {
    const files = [
      {
        path: "main.tex",
        content: "\\section{Supplementary Material}\nWe prove it. % we will add more\n$we will add$ ok.",
      },
    ];
    expect(promises(files)).toEqual([]);
  });

  it("fingerprints by sentence so Ignore holds and settings can turn it off", () => {
    const files = [{ path: "main.tex", content: "We will add a baseline in the final version." }];
    const [finding] = promises(files);
    expect(finding.fingerprint).toBe("writing-open-promise:We will add a baseline in the final version.");
    const ignored = runProjectWritingRules(files, {
      ...context,
      settings: { ...DEFAULT_WRITING_SETTINGS, ignored: [finding.fingerprint ?? ""] },
    });
    expect(ignored.filter((entry) => entry.id === "writing-open-promise")).toEqual([]);
    const disabled = runProjectWritingRules(files, {
      ...context,
      settings: { ...DEFAULT_WRITING_SETTINGS, disabled: ["writing-open-promise"] },
    });
    expect(disabled.filter((entry) => entry.id === "writing-open-promise")).toEqual([]);
  });
});
