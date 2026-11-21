import { describe, expect, it } from "vitest";
import { PREFLIGHT_MESSAGE_KEYS } from "../messages";
import type { Finding } from "../types";
import {
  WRITING_RULE_IDS,
  collectMacroTexts,
  detectWritingProfile,
  parseWritingSettings,
  runWritingRules,
  serializeWritingSettings,
  type WritingSettings,
} from "./index";

const paper = (body: string, preamble = "") => `\\documentclass{article}\n${preamble}\\begin{document}\n${body}\n\\end{document}\n`;

function applyFix(text: string, finding: Finding): string {
  const edits = [...(finding.fix?.edits ?? [])].sort((left, right) => right.from - left.from);
  return edits.reduce((out, edit) => out.slice(0, edit.from) + edit.insert + out.slice(edit.to), text);
}

function only(text: string, id: string, settings?: WritingSettings): Finding[] {
  return runWritingRules(text, settings ? { settings } : {}).filter((finding) => finding.id === id);
}

describe("writing rules", () => {
  it("stays fast on text built to make its patterns backtrack", () => {
    for (const body of [
      `)${"\t".repeat(50_000)}x`,
      "\\[a".repeat(20_000),
      "$$a".repeat(20_000),
      "\\begin{table}[\\".repeat(20_000),
      "\\begin{table} x ".repeat(20_000),
      "\\begin{equation} x ".repeat(20_000),
    ]) {
      expect(Array.isArray(runWritingRules(paper(body), {}))).toBe(true);
    }
    expect(detectWritingProfile([`\\usepackage${"\t".repeat(50_000)}x`])).toBe("general");
  });

  it("adds a space before an acronym in parentheses", () => {
    const text = paper("Convolutional neural network(CNN) has been applied widely.");
    const [finding] = only(text, "writing-space-before-paren");
    expect(applyFix(text, finding)).toContain("network (CNN) has");
  });

  it("removes the space before a period or comma", () => {
    const text = paper("It works on various vision problems . Then , it stops.");
    const findings = only(text, "writing-space-before-punctuation");
    expect(findings).toHaveLength(2);
    expect(findings.reduce((out, _finding, index) => applyFix(out, findings[findings.length - 1 - index]), text)).toContain(
      "problems. Then, it",
    );
  });

  it("keeps math and command arguments out of the prose rules", () => {
    const text = paper("We set $f(X)$ and \\ref{fig:a(B)} here, where $x , y$ vary.");
    expect(only(text, "writing-space-before-paren")).toEqual([]);
    expect(only(text, "writing-space-before-punctuation")).toEqual([]);
  });

  it("joins a citation to the word before it with a tilde", () => {
    const text = paper("A proposes a method B for this problem \\cite{b}. See Fig.\\ref{fig:a} and Table~\\ref{tab:a}.");
    const findings = only(text, "writing-nonbreaking-reference");
    expect(findings).toHaveLength(2);
    const fixed = applyFix(applyFix(text, findings[1]), findings[0]);
    expect(fixed).toContain("problem~\\cite{b}");
    expect(fixed).toContain("Fig.~\\ref{fig:a}");
  });

  it("does not ask for a tilde after a sentence-ending period or before \\citet", () => {
    const text = paper("This is known.\\cite{a} As \\citet{b} showed, it holds.");
    expect(only(text, "writing-nonbreaking-reference")).toEqual([]);
  });

  it("turns straight quotes into LaTeX quotes in pairs", () => {
    const text = paper('Are you "okay"? Yes.');
    const [finding] = only(text, "writing-straight-quotes");
    expect(applyFix(text, finding)).toContain("Are you ``okay''?");
  });

  it("leaves quotes alone when babel makes them a shorthand", () => {
    const text = paper('Das ist "a schon.', "\\usepackage[ngerman]{babel}\n");
    expect(only(text, "writing-straight-quotes")).toEqual([]);
  });

  it("flags a citation inside the abstract", () => {
    const text = paper("\\begin{abstract}\nWe extend prior work \\cite{x}.\n\\end{abstract}\nIntro~\\cite{y}.");
    expect(only(text, "writing-cite-in-abstract")).toHaveLength(1);
  });

  it("spells out an abbreviation that starts a sentence", () => {
    const text = paper("It works. Fig.~\\ref{fig:a} shows it, as in Fig.~\\ref{fig:b}.\n\nEq.~\\ref{eq:a} holds.");
    const findings = only(text, "writing-abbreviation-at-sentence-start");
    expect(findings).toHaveLength(2);
    expect(applyFix(text, findings[0])).toContain("It works. Figure~\\ref{fig:a}");
    expect(applyFix(text, findings[1])).toContain("Equation~\\ref{eq:a}");
  });

  it("asks for punctuation at the end of a display equation", () => {
    const text = paper("The energy is\n\\begin{equation}\n  E = mc^2 \\label{eq:e}\n\\end{equation}\nwhere $m$ is mass.\n\\begin{equation}\n  a = b.\n\\end{equation}");
    const [finding] = only(text, "writing-display-math-punctuation");
    expect(applyFix(text, finding)).toContain("E = mc^2, \\label{eq:e}");
    expect(only(text, "writing-display-math-punctuation")).toHaveLength(1);
  });

  it("checks caption placement in tables and figures", () => {
    const text = paper(
      "\\begin{table}\\centering\\begin{tabular}{cc}a&b\\\\\\end{tabular}\\caption{Below}\\end{table}\n" +
        "\\begin{figure}\\caption{Above}\\includegraphics{x}\\end{figure}\n" +
        "\\begin{table}\\caption{Fine}\\begin{tabular}{c}a\\end{tabular}\\end{table}",
    );
    expect(only(text, "writing-table-caption-below")).toHaveLength(1);
    expect(only(text, "writing-figure-caption-above")).toHaveLength(1);
  });

  it("suggests a macro where its text is typed out", () => {
    const preamble = "\\newcommand{\\NetName}{PS-FCN}\n\\newcommand{\\Data}{Light Stage Data\\xspace}\n";
    const text = paper("We train PS-FCN on the Light Stage Data now.", preamble);
    const findings = only(text, "writing-macro-available");
    expect(findings.map((finding) => applyFix(text, finding))).toEqual([
      expect.stringContaining("We train \\NetName{} on"),
      expect.stringContaining("the \\Data now"),
    ]);
  });

  it("collects plain-text macros, including the CVPR \\eg form", () => {
    const macros = collectMacroTexts(["\\def\\eg{\\emph{e.g}\\onedot}\n\\newcommand{\\ours}{ours}\n\\newcommand{\\f}[1]{#1}"]);
    expect(macros).toEqual([{ name: "eg", text: "e.g.", spacing: "xspace" }]);
  });

  it("applies the CVPR-style rules only to CVPR-style papers", () => {
    const body = "Our results are shown in Tab.~\\ref{tab:a}.\n\\begin{equation*}\n a = b.\n\\end{equation*}\n\\begin{figure}[h]\\caption{c}\\end{figure}";
    const general = paper(body);
    const cvpr = paper(body, "\\usepackage[review]{cvpr}\n");
    expect(detectWritingProfile([cvpr])).toBe("cvpr");
    expect(only(general, "writing-table-abbreviation")).toEqual([]);
    const [table] = only(cvpr, "writing-table-abbreviation");
    expect(applyFix(cvpr, table)).toContain("shown in Table~\\ref{tab:a}");
    const [equation] = only(cvpr, "writing-unnumbered-equation");
    expect(applyFix(cvpr, equation)).toContain("\\begin{equation}\n a = b.\n\\end{equation}");
    const [float] = only(cvpr, "writing-float-placement");
    expect(applyFix(cvpr, float)).toContain("\\begin{figure}[t]");
  });

  it("runs the project's own rules and honours ignore and disable lists", () => {
    const settings = parseWritingSettings({
      rules: [{ id: "rule-1", find: "dataset", replace: "data set", note: "Lab style." }],
    });
    const text = paper("The dataset is large. Another dataset follows.");
    const findings = only(text, "writing-custom", settings);
    expect(findings).toHaveLength(2);
    expect(applyFix(text, findings[0])).toContain("The data set is");
    const ignored = parseWritingSettings({ ...serializeWritingSettings(settings), ignored: [findings[0].fingerprint] });
    expect(only(text, "writing-custom", ignored)).toEqual([]);
    const disabled = parseWritingSettings({ ...serializeWritingSettings(settings), disabled: ["writing-custom"] });
    expect(only(text, "writing-custom", disabled)).toEqual([]);
  });

  it("keeps checking when only the editor underlines are switched off", () => {
    const settings = parseWritingSettings({ underlines: false });
    expect(settings.underlines).toBe(false);
    expect(serializeWritingSettings(settings)).toEqual({ underlines: false });
    expect(runWritingRules(paper("Bad(CNN) here."), { settings })).toHaveLength(1);
  });

  it("ignores the preamble and comments", () => {
    const text = paper("Fine text.", "\\title{A network(CNN) title}\n% a comment(CNN) .\n");
    expect(runWritingRules(text)).toEqual([]);
  });

  it("declares a title and detail message for every rule", () => {
    for (const id of WRITING_RULE_IDS) {
      expect(PREFLIGHT_MESSAGE_KEYS).toContain(`rules.${id}.title`);
      expect(PREFLIGHT_MESSAGE_KEYS).toContain(`rules.${id}.detail`);
    }
  });
});

describe("writing settings", () => {
  it("round-trips and drops bad entries", () => {
    const parsed = parseWritingSettings({
      profile: "cvpr",
      disabled: ["writing-straight-quotes", 4, ""],
      rules: [
        { id: "a", find: "foo", replace: "bar", whole_word: false },
        { id: "a", find: "dup", replace: "x" },
        { id: "bad id", find: "x", replace: "y" },
        { id: "b", find: "   ", replace: "y" },
        { id: "c", find: "flag me", replace: null },
      ],
    });
    expect(parsed.profile).toBe("cvpr");
    expect(parsed.disabled).toEqual(["writing-straight-quotes"]);
    expect(parsed.rules.map((rule) => rule.id)).toEqual(["a", "c"]);
    expect(parsed.rules[0].wholeWord).toBe(false);
    expect(parseWritingSettings(serializeWritingSettings(parsed))).toEqual(parsed);
    expect(serializeWritingSettings(parseWritingSettings(undefined))).toBeNull();
  });
});
