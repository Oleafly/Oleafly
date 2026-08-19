import { describe, expect, it } from "vitest";
import { runSubmissionRules } from "./submission-rules";
import type { PdfFacts, ProjectContext } from "./types";

const project = (content: string, extra: ProjectContext["files"] = []): ProjectContext => ({
  mainFile: "main.tex",
  files: [{ path: "main.tex", content }, ...extra],
});

const pdf = (over: Partial<PdfFacts> = {}): PdfFacts => ({
  version: "1.7",
  pageCount: 6,
  pages: Array.from({ length: 6 }, () => ({ width: 612, height: 792, rotation: 0 })),
  outlineCount: 0,
  linkCount: 0,
  attachmentCount: 0,
  formFieldCount: 0,
  restricted: false,
  author: null,
  creator: "LaTeX",
  producer: "pdfTeX",
  fonts: [{ name: "CMR10", embedded: true }],
  ...over,
});

const cleanArticle = String.raw`\documentclass{article}
\begin{document}
\begin{abstract}A complete abstract.\end{abstract}
\begin{figure}\includegraphics{fig.pdf}\caption{Result}\label{fig:result}\end{figure}
\end{document}`;

describe("submission source portability", () => {
  it("accepts a complete publisher-neutral project", () => {
    const findings = runSubmissionRules({
      project: project(cleanArticle, [{ path: "fig.pdf" }]),
      profileId: "generic",
      pdf: pdf(),
    });
    expect(findings).toEqual([]);
  });

  it("finds arXiv filename and case-sensitivity failures", () => {
    const source = String.raw`\documentclass{article}
\begin{abstract}Abstract\end{abstract}
\includegraphics{Figures/Plot.PNG}`;
    const findings = runSubmissionRules({
      project: project(source, [{ path: "Figures/My Plot.png" }, { path: "Figures/plot.PNG" }]),
      profileId: "arxiv",
    });
    expect(findings.map((finding) => finding.id)).toContain("submission-nonportable-filename");
    expect(findings.map((finding) => finding.id)).toContain("submission-path-case");
  });

  it("finds local paths and shell-escape dependencies", () => {
    const source = String.raw`\documentclass{article}
\begin{abstract}Abstract\end{abstract}
\input{/Users/alex/private/macros.tex}
\usepackage{minted}`;
    const ids = runSubmissionRules({ project: project(source), profileId: "generic" }).map((finding) => finding.id);
    expect(ids).toContain("submission-absolute-path");
    expect(ids).toContain("submission-shell-escape");
  });
});

describe("venue PDF requirements", () => {
  it("enforces IEEE class, annotations, attachments, security, and font embedding", () => {
    const source = String.raw`\documentclass{article}
\begin{abstract}Abstract\end{abstract}
\begin{IEEEkeywords}testing\end{IEEEkeywords}`;
    const findings = runSubmissionRules({
      project: project(source),
      profileId: "ieee",
      pdf: pdf({
        outlineCount: 2,
        linkCount: 1,
        attachmentCount: 1,
        restricted: true,
        fonts: [{ name: "Helvetica", embedded: false }],
      }),
    });
    const ids = findings.map((finding) => finding.id);
    expect(ids).toEqual(expect.arrayContaining([
      "submission-document-class",
      "submission-bookmarks",
      "submission-links",
      "submission-attachments",
      "submission-security",
      "submission-unembedded-font",
    ]));
  });
});

describe("privacy and blind review", () => {
  it("detects secrets without echoing them into finding text", () => {
    const token = `sk-${"a".repeat(32)}`;
    const findings = runSubmissionRules({
      project: project(`\\documentclass{article}\n% token below\n${token}\n\\begin{abstract}A\\end{abstract}`),
      profileId: "generic",
    });
    const finding = findings.find((item) => item.id === "privacy-credential");
    expect(finding).toBeDefined();
    expect(JSON.stringify(finding)).not.toContain(token);
  });

  it("checks both source identity and PDF author metadata for blind review", () => {
    const source = String.raw`\documentclass{article}
\author{Alex Chen}
\begin{abstract}Abstract\end{abstract}`;
    const ids = runSubmissionRules({
      project: project(source),
      profileId: "generic",
      anonymousReview: true,
      pdf: pdf({ author: "Alex Chen" }),
    }).map((finding) => finding.id);
    expect(ids).toContain("privacy-blind-author");
    expect(ids).toContain("privacy-pdf-author");
  });
});
