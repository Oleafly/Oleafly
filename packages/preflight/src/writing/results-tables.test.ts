import { describe, expect, it } from "vitest";
import type { Finding } from "../types";
import { DEFAULT_WRITING_SETTINGS, runWritingRules } from "./index";

const paper = (body: string) => `\\documentclass{article}\n\\usepackage{booktabs}\n\\begin{document}\n${body}\n\\end{document}\n`;

function findings(text: string): Finding[] {
  return runWritingRules(text).filter((finding) => finding.id === "writing-results-best");
}

function applyFix(text: string, finding: Finding): string {
  const edits = [...(finding.fix?.edits ?? [])].sort((left, right) => right.from - left.from);
  return edits.reduce((out, edit) => out.slice(0, edit.from) + edit.insert + out.slice(edit.to), text);
}

const RESULTS = String.raw`\begin{table}[t]
\centering
\begin{tabular}{@{}lcc@{}}
\toprule
Method & PSNR$\uparrow$ & LPIPS$\downarrow$ \\
\midrule
Bicubic & 28.42 & 0.312 \\
SRCNN~\cite{dong} & \textbf{30.48} & 0.215 \\
EDSR & 31.02 & \textbf{0.198} \\
\bottomrule
\end{tabular}
\end{table}`;

describe("writing-results-best", () => {
  it("flags a bold value that is not the best and moves the bold to the best value", () => {
    const text = paper(RESULTS);
    const [finding, ...rest] = findings(text);
    expect(rest).toEqual([]);
    expect(text.slice(finding.from, finding.to)).toBe("\\textbf{30.48}");
    expect(finding.detail).toEqual({ key: "rules.writing-results-best.detail", params: { value: "30.48", best: "31.02" } });
    expect(finding.fix?.label).toEqual({ key: "fixes.boldBest", params: { value: "31.02" } });
    const fixed = applyFix(text, finding);
    expect(fixed).toContain("SRCNN~\\cite{dong} & 30.48 & 0.215");
    expect(fixed).toContain("EDSR & \\textbf{31.02} & \\textbf{0.198}");
    expect(findings(fixed)).toEqual([]);
  });

  it("reads multicolumn headers over cmidrules and checks each metric column", () => {
    const text = paper(String.raw`\begin{tabular}{lcccc}
\toprule
\multirow{2}{*}{Method} & \multicolumn{2}{c}{Set5} & \multicolumn{2}{c}{Set14} \\
\cmidrule(lr){2-3} \cmidrule(lr){4-5}
 & PSNR & SSIM & PSNR & SSIM \\
\midrule
A & 30.1 & 0.912 & 27.3 & \textbf{0.801} \\
B & \textbf{31.4} & \textbf{0.921} & \textbf{27.9} & 0.799 \\
C & 29.8 & 0.905 & 26.5 & 0.812 \\
\bottomrule
\end{tabular}`);
    const [finding, ...rest] = findings(text);
    expect(rest).toEqual([]);
    expect(finding.detail.params).toEqual({ value: "0.801", best: "0.812" });
    expect(applyFix(text, finding)).toContain("C & 29.8 & 0.905 & 26.5 & \\textbf{0.812} \\\\");
  });

  it("counts a tie as best and bolds every tied value", () => {
    const tie = paper(String.raw`\begin{tabular}{lc}
\toprule
Model & Acc. (\%) \\
\midrule
A & \textbf{91.2} \\
B & \textbf{91.2} \\
C & 90.0 \\
\bottomrule
\end{tabular}`);
    expect(findings(tie)).toEqual([]);
    const wrong = tie.replace("C & 90.0", "C & \\textbf{89.0}").replace(/\\textbf\{91\.2\}/g, "91.2");
    const [finding] = findings(wrong);
    const fixed = applyFix(wrong, finding);
    expect(fixed.match(/\\textbf\{91\.2\}/g)).toHaveLength(2);
    expect(fixed).toContain("C & 89.0");
  });

  it("checks underlines for the second best only in columns that use them", () => {
    const text = paper(String.raw`\begin{tabular}{lcc}
\toprule
Method & FID$\downarrow$ & IS$\uparrow$ \\
\midrule
A & 12.4 & 9.1 \\
B & \underline{10.2} & \underline{9.3} \\
C & \textbf{8.7} & \textbf{9.5} \\
D & 9.9 & 7.2 \\
\bottomrule
\end{tabular}`);
    const [finding, ...rest] = findings(text);
    expect(rest).toEqual([]);
    expect(finding.title).toEqual({ key: "rules.writing-results-best.titleSecond" });
    expect(finding.detail).toEqual({
      key: "rules.writing-results-best.detailSecondLower",
      params: { value: "10.2", best: "9.9" },
    });
    expect(applyFix(text, finding)).toContain("B & 10.2 & \\underline{9.3}");
    expect(applyFix(text, finding)).toContain("D & \\underline{9.9} & 7.2");
  });

  it("uses math bold inside math cells and keeps the plus-minus part", () => {
    const text = paper(String.raw`\begin{tabular}{lc}
\hline
Method & Error (\%) \\
\hline
A & $\mathbf{4.2} \pm 0.3$ \\
B & $3.9 \pm 0.2$ \\
C & $5.1 \pm 0.4$ \\
\hline
\end{tabular}`);
    const [finding] = findings(text);
    expect(finding.detail.key).toBe("rules.writing-results-best.detailLower");
    const fixed = applyFix(text, finding);
    expect(fixed).toContain("A & $4.2 \\pm 0.3$");
    expect(fixed).toContain("B & $\\mathbf{3.9} \\pm 0.2$");
  });

  it("follows bold per group when each group marks its own best", () => {
    const text = paper(String.raw`\begin{tabular}{lc}
\toprule
Method & mIoU \\
\midrule
\multicolumn{2}{l}{\textit{Supervised}} \\
A & 70.1 \\
B & \textbf{72.4} \\
\midrule
\multicolumn{2}{l}{\textit{Unsupervised}} \\
C & 40.2 \\
D & {\bf 45.0} \\
\bottomrule
\end{tabular}`);
    expect(findings(text)).toEqual([]);
  });

  it("checks a lone bold row against the whole column", () => {
    const text = paper(String.raw`\begin{tabular}{lc}
\toprule
Method & mIoU \\
\midrule
A & 70.1 \\
B & 72.4 \\
\midrule
Ours & {\bf 71.0} \\
\bottomrule
\end{tabular}`);
    const [finding] = findings(text);
    expect(finding.detail.params).toEqual({ value: "71.0", best: "72.4" });
    const fixed = applyFix(text, finding);
    expect(fixed).toContain("Ours & {71.0}");
    expect(fixed).toContain("B & \\textbf{72.4}");
  });

  it("leaves a fully bold row for the authors' own method alone", () => {
    const text = paper(String.raw`\begin{tabular}{lcc}
\toprule
Method & PSNR & SSIM \\
\midrule
A & 30.0 & 0.95 \\
\textbf{Ours} & \textbf{31.0} & \textbf{0.93} \\
\bottomrule
\end{tabular}`);
    expect(findings(text)).toEqual([]);
  });

  it("skips unknown columns, sparse columns and commented rows", () => {
    const text = paper(String.raw`\begin{tabular}{lccc}
\toprule
Method & Year & Recall & Dice \\
\midrule
A & \textbf{2019} & 0.5 & -- \\
% B & 2020 & 0.9 & 0.8 \\
C & 2021 & \textbf{0.7} & \textbf{0.6} \\
\bottomrule
\end{tabular}`);
    expect(findings(text)).toEqual([]);
  });

  it("reads tabularx, NiceTabular and a nested header tabular", () => {
    const text = paper(String.raw`\begin{tabularx}{\linewidth}{Xcc}
\toprule
Method & \begin{tabular}[c]{@{}c@{}}Latency\\(ms)\end{tabular} & Top-1 \\
\midrule
A & \textbf{12} & 76.1 \\
B & 9 & \textbf{78.3} \\
\bottomrule
\end{tabularx}
\begin{NiceTabular}{lc}[hvlines]
Method & BLEU \\
A & \textbf{27.1} \\
B & 28.4 \\
\end{NiceTabular}`);
    const results = findings(text);
    expect(results.map((finding) => finding.detail.params)).toEqual([
      { value: "12", best: "9" },
      { value: "27.1", best: "28.4" },
    ]);
  });

  it("can be turned off", () => {
    const text = paper(RESULTS);
    const settings = { ...DEFAULT_WRITING_SETTINGS, disabled: ["writing-results-best"] };
    expect(runWritingRules(text, { settings }).filter((finding) => finding.id === "writing-results-best")).toEqual([]);
  });
});
