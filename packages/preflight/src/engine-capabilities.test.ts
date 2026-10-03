import { describe, expect, it } from "vitest";
import { runPreflight } from "./engine";
import { TYPST_SOURCE_RULES } from "./typst";
import type { RefsContext } from "./refs-rules";

const typstRefs = (overrides: Partial<RefsContext> = {}): RefsContext => ({
  definedLabels: [],
  bibKeys: [],
  bibLoaded: false,
  projectFiles: ["main.typ", "refs.bib"],
  duplicateDois: [],
  ...overrides,
});

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

  it("treats the Typst profile as unsupported until its rules are loaded", () => {
    const report = runPreflight({
      source: '#image("a.png")',
      sourceProfile: "typst",
      refs: typstRefs(),
      project: { mainFile: "main.typ", files: [{ path: "main.typ", content: '#image("a.png")' }] },
    });
    expect(report.findings).toEqual([]);
    expect(report.coverage).toMatchObject({ refs: "unsupported", submission: "unsupported", privacy: "unsupported" });
  });

  it("runs Typst rules and reports refs, submission and privacy as evaluated", () => {
    const main = '#set document(title: "Paper", author: "Jane")\n= Abstract\nSee @fig:gone.\n#image("plot.png")\n// TODO: internal';
    const report = runPreflight({
      source: main,
      sourceProfile: "typst",
      sourceRules: TYPST_SOURCE_RULES,
      engine: "typst",
      refs: typstRefs(),
      project: { mainFile: "main.typ", files: [{ path: "main.typ", content: main }, { path: "refs.bib" }] },
      compile: { status: "success", log: "" },
      pages: [[{ str: "Paper", x: 10, y: 10, width: 20 }]],
      meta: { lang: "en", title: "Paper", tagged: true },
      facts: {
        version: "1.7",
        pageCount: 1,
        pages: [],
        outlineCount: 0,
        linkCount: 0,
        attachmentCount: 0,
        formFieldCount: 0,
        restricted: false,
        author: null,
        creator: null,
        producer: null,
        fonts: [],
      },
    });
    const ids = report.findings.map((finding) => finding.id);
    expect(ids).toEqual(
      expect.arrayContaining(["figure-alt", "refs-undefined-ref", "refs-missing-asset", "privacy-internal-comment"]),
    );
    expect(report.findings.find((finding) => finding.id === "figure-alt")?.file).toBe("main.typ");
    expect(ids).not.toContain("no-glyphtounicode");
    expect(report.coverage).toMatchObject({ refs: "evaluated", submission: "evaluated", privacy: "evaluated" });
    expect(report.refsScore).not.toBeNull();
  });

  it("marks Typst submission checks partial until there is a PDF", () => {
    const report = runPreflight({
      source: "= Abstract",
      sourceProfile: "typst",
      sourceRules: TYPST_SOURCE_RULES,
      project: { mainFile: "main.typ", files: [{ path: "main.typ", content: "= Abstract" }] },
      anonymousReview: true,
    });
    expect(report.coverage.submission).toBe("partial");
    expect(report.coverage.privacy).toBe("partial");
    expect(report.coverage.refs).toBe("unsupported");
  });

  it("passes the project's Typst version to the figure alt rule", () => {
    const source = '#figure(image("a.png"), alt: "A chart", caption: [A])';
    const run = (typstVersion: string) =>
      runPreflight({ source, sourceProfile: "typst", sourceRules: TYPST_SOURCE_RULES, typstVersion }).findings.map(
        (finding) => finding.id,
      );
    expect(run("0.15.1")).not.toContain("figure-alt");
    expect(run("0.13.1")).toContain("figure-alt");
  });

  it("reads document metadata across the Typst project", () => {
    const files = [
      { path: "main.typ", content: '#import "meta.typ": *\n= Intro' },
      { path: "meta.typ", content: '#set document(title: "Paper", author: "Jane")' },
    ];
    const report = runPreflight({
      source: files[0].content,
      sourceProfile: "typst",
      sourceRules: TYPST_SOURCE_RULES,
      project: { mainFile: "main.typ", files },
    });
    const ids = report.findings.map((finding) => finding.id);
    expect(ids).not.toContain("no-title");
    expect(ids).not.toContain("no-author");
  });
});
