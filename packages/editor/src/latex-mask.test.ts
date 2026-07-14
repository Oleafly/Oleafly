import { describe, it, expect } from "vitest";
import { maskLatex, maskToProse, spellcheckRanges } from "./latex-mask";

function words(tex: string): Set<string> {
  return new Set(spellcheckRanges(tex).map((r) => r.word));
}

describe("maskLatex", () => {
  it("preserves length so offsets map 1:1 onto the document", () => {
    const samples = [
      "Plain prose with no macros.",
      "\\section{Title} body \\cite{key} and $x^2$ done.",
      "\\begin{equation}E = mc^2\\end{equation}\ntext",
      "accented café naïve résumé",
    ];
    for (const s of samples) expect(maskLatex(s).length).toBe(s.length);
  });

  it("never blanks newlines (line numbers stay aligned)", () => {
    const s = "line one\n\\cite{x}\nline three";
    const masked = maskLatex(s);
    expect(masked.split("\n").length).toBe(s.split("\n").length);
  });

  describe("removes non-prose (false positives)", () => {
    it("drops \\ref / \\eqref / \\cite / \\label keys", () => {
      const w = words("See \\eqref{eq:sdpa} and \\cite{vaswani2017}; \\label{sec:intro}.");
      expect(w.has("eq")).toBe(false);
      expect(w.has("sdpa")).toBe(false);
      expect(w.has("vaswani")).toBe(false);
      expect(w.has("sec")).toBe(false);
      expect(w.has("intro")).toBe(false);
    });

    it("drops \\usepackage / \\documentclass / \\includegraphics arguments", () => {
      const w = words("\\documentclass{article}\\usepackage{amsmath}\\includegraphics{fig/plot.png}");
      expect(w.has("article")).toBe(false);
      expect(w.has("amsmath")).toBe(false);
      expect(w.has("plot")).toBe(false);
      expect(w.has("fig")).toBe(false);
    });

    it("masks math environments (equation, align)", () => {
      const w = words("\\begin{align}\\mathrm{Attention}(Q,K,V) = \\mathrm{softmax}(QK)V\\end{align}");
      expect(w.has("Attention")).toBe(false);
      expect(w.has("softmax")).toBe(false);
      expect(w.has("align")).toBe(false);
    });

    it("masks inline and bracket math", () => {
      const w = words("value $x_{ij}^2$ and \\[ \\gamma = \\beta \\] end");
      expect(w.has("ij")).toBe(false);
      expect(w.has("gamma")).toBe(false);
      expect(w.has("beta")).toBe(false);
      expect(w.has("value")).toBe(true);
      expect(w.has("end")).toBe(true);
    });

    it("masks verbatim / code environments", () => {
      const w = words("\\begin{verbatim}\nfor i in range(10): teh code\n\\end{verbatim}");
      expect(w.has("teh")).toBe(false);
      expect(w.has("code")).toBe(false);
      expect(w.has("verbatim")).toBe(false);
    });

    it("drops \\begin/\\end environment names but keeps the body", () => {
      const w = words("\\begin{itemize}\\item Real prose here\\end{itemize}");
      expect(w.has("itemize")).toBe(false);
      expect(w.has("Real")).toBe(true);
      expect(w.has("prose")).toBe(true);
    });

    it("blanks a line-break spacing unit like \\\\[3pt]", () => {
      expect(words("Name\\\\[3pt] Title").has("pt")).toBe(false);
    });

    it("ignores comments", () => {
      const w = words("real text % teh commented mistake here\nmore");
      expect(w.has("teh")).toBe(false);
      expect(w.has("commented")).toBe(false);
      expect(w.has("real")).toBe(true);
      expect(w.has("more")).toBe(true);
    });
  });

  describe("keeps real prose (no false negatives)", () => {
    it("keeps section titles and text-formatting arguments", () => {
      const w = words("\\section{Introduction} \\textbf{Bold claim} \\emph{stressed}");
      expect(w.has("Introduction")).toBe(true);
      expect(w.has("Bold")).toBe(true);
      expect(w.has("claim")).toBe(true);
      expect(w.has("stressed")).toBe(true);
    });

    it("keeps unknown/custom macro prose arguments", () => {
      const w = words("\\role{Senior Software Engineer}{Google}");
      expect(w.has("Senior")).toBe(true);
      expect(w.has("Software")).toBe(true);
      expect(w.has("Engineer")).toBe(true);
      expect(w.has("Google")).toBe(true);
    });

    it("keeps a real misspelling so it can be flagged", () => {
      // Regression for: 'Senior Softwar Engineer' produced no warning.
      expect(words("Senior Softwar Engineer").has("Softwar")).toBe(true);
    });

    it("blanks \\href entirely (url + shown text are not prose to proofread)", () => {
      const hw = words("\\href{https://alexchen.dev}{alexchen.dev} \\href{mailto:a@b.com}{a@b.com}");
      expect(hw.has("alexchen")).toBe(false);
      expect(hw.has("dev")).toBe(false);
      expect(hw.has("com")).toBe(false);
    });

    it("for \\textcolor, drops the color but keeps the shown text", () => {
      const cw = words("\\textcolor{red}{Hello there}");
      expect(cw.has("red")).toBe(false);
      expect(cw.has("Hello")).toBe(true);
      expect(cw.has("there")).toBe(true);
    });

    it("blanks dimension arguments of \\vspace / \\hspace", () => {
      const w = words("\\vspace{2pt} real text \\hspace{1.5in} more");
      expect(w.has("pt")).toBe(false);
      expect(w.has("in")).toBe(false);
      expect(w.has("real")).toBe(true);
      expect(w.has("more")).toBe(true);
    });

    it("keeps table cell prose (tabular is not opaque)", () => {
      const w = words("\\begin{tabular}{lc} Model & Result \\\\ Transformer & Best \\end{tabular}");
      expect(w.has("Model")).toBe(true);
      expect(w.has("Transformer")).toBe(true);
    });
  });

  it("reports word ranges that slice back to the original text", () => {
    const src = "A \\cite{k} boundary word.";
    for (const r of spellcheckRanges(src)) {
      expect(src.slice(r.from, r.to)).toBe(r.word);
    }
  });
});

describe("maskToProse (Harper input)", () => {
  it("collapses masking gaps so there are no multi-space runs", () => {
    // The gaps a masked \command leaves behind are what triggered Harper's
    // 'N spaces where there should be only one' false positives.
    const { prose } = maskToProse("Alpha \\hypersetup{colorlinks=true} Beta \\vspace{2pt} Gamma");
    expect(prose).not.toMatch(/ {2,}/); // no run of 2+ spaces
    expect(prose.split(/\s+/)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("does not leave a space before trailing punctuation", () => {
    // A gap left by an opaque-arg command right before punctuation must not
    // become a stray "word ." (which Harper would flag).
    const { prose } = maskToProse("End of thought\\hspace{2pt}. Next one.");
    expect(prose).toContain("thought.");
    expect(prose).not.toContain("thought .");
  });

  it("maps lint spans back to the exact original word", () => {
    const src = "Senior \\textbf{Softwar} Engineer at \\href{u}{link}.";
    const { prose, map } = maskToProse(src);
    const at = prose.indexOf("Softwar");
    expect(at).toBeGreaterThanOrEqual(0);
    const from = map[at];
    const to = map[at + "Softwar".length - 1] + 1;
    expect(src.slice(from, to)).toBe("Softwar");
  });

  it("map length matches prose length", () => {
    const { prose, map } = maskToProse("one \\cmd{x} two\n\\begin{equation}z\\end{equation} three");
    expect(map.length).toBe(prose.length);
  });
});
