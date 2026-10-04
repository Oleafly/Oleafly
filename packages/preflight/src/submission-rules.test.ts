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
  it("detects sensitive files by basename without scanning paths with a broad expression", () => {
    const ids = runSubmissionRules({
      project: project(cleanArticle, [
        { path: "private/.env.production" },
        { path: "keys/id_ed25519" },
        { path: "certificates/signing.P12" },
      ]),
      profileId: "generic",
    }).map((finding) => finding.id);
    expect(ids.filter((id) => id === "privacy-sensitive-file")).toHaveLength(3);
  });

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

  it.each([
    ["% TODO fix the margins", true],
    ["  \t% FIXME later", true],
    ["%CONFIDENTIAL", true],
    ["%% DO NOT DISTRIBUTE %%", true],
    ["\t%\tINTERNAL ONLY", true],
    ["% internal only", true],
    ["%TODOS are fine", false],
    ["TODO in plain prose", false],
    ["\\section{TODO} % a clean comment", false],
    ["x % TODO after code", false],
  ])("flags %j as an internal comment: %s", (line, flagged) => {
    const ids = runSubmissionRules({
      project: project(
        `\\documentclass{article}\n${line}\n\\begin{abstract}A\\end{abstract}`,
      ),
      profileId: "generic",
    }).map((finding) => finding.id);
    expect(ids.includes("privacy-internal-comment")).toBe(flagged);
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

function findingsFor(input: Parameters<typeof runSubmissionRules>[0]) {
  return runSubmissionRules(input);
}

function idsFor(input: Parameters<typeof runSubmissionRules>[0]) {
  return findingsFor(input).map((finding) => finding.id);
}

describe("figures, tables and references", () => {
  it("asks for a caption on figures and tables that lack one", () => {
    const source = String.raw`\documentclass{article}
\begin{abstract}A\end{abstract}
\begin{figure}\includegraphics{fig.pdf}\end{figure}
\begin{table*}\begin{tabular}{l}x\end{tabular}\end{table*}`;
    const captions = findingsFor({ project: project(source, [{ path: "fig.pdf" }]), profileId: "generic" }).filter(
      (finding) => finding.id === "submission-missing-caption",
    );
    expect(captions.map((finding) => finding.title.key)).toEqual([
      "rules.submission-missing-caption.titleFigure",
      "rules.submission-missing-caption.titleTable",
    ]);
    expect(captions.every((finding) => finding.file === "main.tex" && finding.severity === "warning")).toBe(true);
  });

  it("warns when a label comes before its caption", () => {
    const source = String.raw`\documentclass{article}
\begin{abstract}A\end{abstract}
\begin{figure}\includegraphics{fig.pdf}\label{fig:a}\caption{Late}\end{figure}`;
    const finding = findingsFor({ project: project(source, [{ path: "fig.pdf" }]), profileId: "generic" }).find(
      (item) => item.id === "submission-label-before-caption",
    );
    expect(finding).toMatchObject({ lens: "refs", severity: "warning", file: "main.tex" });
  });

  it("reports included files and figures that are not in the project", () => {
    const source = String.raw`\documentclass{article}
\begin{abstract}A\end{abstract}
\input{sections/missing}
\includegraphics{figs/absent}`;
    const findings = findingsFor({ project: project(source), profileId: "generic" }).filter(
      (finding) => finding.id === "submission-missing-project-file",
    );
    expect(findings.map((finding) => finding.title)).toEqual([
      { key: "rules.submission-missing-project-file.titleFigure", params: { target: "figs/absent" } },
      { key: "rules.submission-missing-project-file.titleInclude", params: { target: "sections/missing" } },
    ]);
  });

  it("resolves references relative to the including file, the project root and dot segments", () => {
    const chapter = String.raw`\input{../shared/macros}
\includegraphics{./img/plot}
\includegraphics{/figs/root.png}
\includegraphics{https://example.com/remote.png}
\includegraphics{data:image/png;base64,AA}`;
    const ids = idsFor({
      project: project(cleanArticle, [
        { path: "fig.pdf" },
        { path: "chapters/one.tex", content: chapter },
        { path: "shared/macros.tex" },
        { path: "chapters/img/plot.pdf" },
        { path: "figs/root.png" },
      ]),
      profileId: "generic",
    });
    expect(ids).not.toContain("submission-missing-project-file");
    expect(ids).not.toContain("submission-path-case");
  });

  it("names the case-mismatched file it found for an include", () => {
    const source = String.raw`\documentclass{article}
\begin{abstract}A\end{abstract}
\input{Sections/Intro}`;
    const finding = findingsFor({
      project: project(source, [{ path: "sections/intro.tex" }]),
      profileId: "generic",
    }).find((item) => item.id === "submission-path-case");
    expect(finding?.detail).toEqual({
      key: "rules.submission-path-case.detailInclude",
      params: { match: "sections/intro.tex" },
    });
  });
});

describe("venue source requirements", () => {
  it("accepts the recommended class with keywords and flags a missing class or keywords", () => {
    const acm = String.raw`\documentclass[sigconf]{acmart}
\keywords{testing}
\begin{abstract}A\end{abstract}`;
    expect(idsFor({ project: project(acm), profileId: "acm" })).toEqual([]);

    const bare = String.raw`\begin{abstract}A\end{abstract}`;
    const findings = findingsFor({ project: project(bare), profileId: "acm" });
    expect(findings.map((finding) => finding.id)).toEqual(["submission-document-class", "submission-no-keywords"]);
    expect(findings[0].detail).toEqual({
      key: "rules.submission-document-class.detailNoClass",
      params: { expected: "acmart" },
    });
  });

  it("asks for an abstract when the profile requires one", () => {
    expect(idsFor({ project: project(String.raw`\documentclass{article}`), profileId: "thesis" })).toContain(
      "submission-no-abstract",
    );
  });

  it("rejects figure formats arXiv does not process and accepts extensionless graphics", () => {
    const source = String.raw`\documentclass{article}
\begin{abstract}A\end{abstract}
\begin{figure}\includegraphics{plot.tiff}\includegraphics{diagram}\caption{C}\end{figure}`;
    const findings = findingsFor({
      project: project(source, [{ path: "plot.tiff" }, { path: "diagram.pdf" }]),
      profileId: "arxiv",
    }).filter((finding) => finding.id === "submission-figure-format");
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toEqual({ key: "rules.submission-figure-format.title", params: { file: "plot.tiff" } });
  });

  it("flags placeholders left in the source", () => {
    const source = String.raw`\documentclass{article}
\begin{abstract}Results are ?? percent better. Lorem ipsum.\end{abstract}`;
    expect(idsFor({ project: project(source), profileId: "generic" })).toContain("submission-placeholder");
  });

  it("lists build leftovers as advisory information", () => {
    const findings = findingsFor({
      project: project(cleanArticle, [{ path: "fig.pdf" }, { path: "main.aux" }, { path: "build/main.synctex.gz" }]),
      profileId: "generic",
    }).filter((finding) => finding.id === "submission-generated-file");
    expect(findings.map((finding) => [finding.file, finding.severity, finding.certainty])).toEqual([
      ["main.aux", "info", "advisory"],
      ["build/main.synctex.gz", "info", "advisory"],
    ]);
  });
});

describe("venue PDF details", () => {
  const ieeeSource = String.raw`\documentclass{IEEEtran}
\begin{abstract}A\end{abstract}
\begin{IEEEkeywords}testing\end{IEEEkeywords}`;

  it("rejects a PDF older than the venue minimum", () => {
    const finding = findingsFor({ project: project(ieeeSource), profileId: "ieee", pdf: pdf({ version: "1.3" }) }).find(
      (item) => item.id === "submission-pdf-version",
    );
    expect(finding?.title).toEqual({ key: "rules.submission-pdf-version.title", params: { version: "1.3" } });
  });

  it("says font inspection was incomplete when embedding could not be read", () => {
    const findings = findingsFor({
      project: project(ieeeSource),
      profileId: "ieee",
      pdf: pdf({ fonts: [{ name: "CMR10", embedded: true }, { name: "Mystery", embedded: null }] }),
    });
    expect(findings.map((finding) => finding.id)).toEqual(["submission-font-inspection-incomplete"]);
    expect(findings[0]).toMatchObject({ severity: "info", certainty: "manual" });
  });

  it("accepts a clean IEEE PDF", () => {
    expect(idsFor({ project: project(ieeeSource), profileId: "ieee", pdf: pdf() })).toEqual([]);
  });
});

describe("draft artifacts and blind review details", () => {
  it.each([
    String.raw`\usepackage{todonotes}`,
    String.raw`\usepackage[final]{showkeys}`,
    String.raw`\todo{check}`,
  ])("flags the draft artifact %s", (line) => {
    const source = `\\documentclass{article}\n${line}\n\\begin{abstract}A\\end{abstract}`;
    expect(idsFor({ project: project(source), profileId: "generic" })).toContain("privacy-draft-artifact");
  });

  it("flags a draft document class option", () => {
    const source = String.raw`\documentclass[11pt,draft]{article}
\begin{abstract}A\end{abstract}`;
    expect(idsFor({ project: project(source), profileId: "generic" })).toContain("privacy-draft-artifact");
  });

  it("accepts anonymised authors and flags acknowledgements under blind review", () => {
    const source = String.raw`\documentclass{article}
\author{Anonymous Authors}
\begin{abstract}A\end{abstract}
\section*{Acknowledgements}We thank our funders.`;
    const ids = idsFor({
      project: project(source),
      profileId: "generic",
      anonymousReview: true,
      pdf: pdf({ author: "Omitted for blind review" }),
    });
    expect(ids).toContain("privacy-blind-acknowledgements");
    expect(ids).not.toContain("privacy-blind-author");
    expect(ids).not.toContain("privacy-pdf-author");
  });

  it("skips blind-review checks when the review is not anonymous", () => {
    const source = String.raw`\documentclass{article}
\author{Alex Chen}
\begin{abstract}A\end{abstract}
\begin{acknowledgments}Thanks.\end{acknowledgments}`;
    const ids = idsFor({ project: project(source), profileId: "generic", pdf: pdf({ author: "Alex Chen" }) });
    expect(ids.filter((id) => id.startsWith("privacy-blind") || id === "privacy-pdf-author")).toEqual([]);
  });
});
