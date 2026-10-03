import { describe, expect, it } from "vitest";
import { runTypstSourceRules, typstMetadataFindings } from "./typst-source-rules";

const ids = (text: string, version?: string) =>
  runTypstSourceRules(text, version ? { version } : undefined).map((finding) => finding.id);
const find = (text: string, id: string, version?: string) =>
  runTypstSourceRules(text, version ? { version } : undefined).find((finding) => finding.id === id);

describe("Typst figure-alt", () => {
  it("flags an image without alt text and covers the call", () => {
    const text = 'Intro\n#image("plot.png", width: 80%)\n';
    const finding = find(text, "figure-alt");
    expect(finding?.lens).toBe("a11y");
    expect(finding?.detail.key).toBe("rules.figure-alt.detailTypstFigure");
    expect(text.slice(finding?.from, finding?.to)).toBe('image("plot.png", width: 80%)');
    expect(finding?.standards?.length).toBeGreaterThan(0);
  });

  it("accepts an image with a description", () => {
    expect(ids('#image("plot.png", alt: "Line chart of error by epoch")')).not.toContain("figure-alt");
  });

  it("rejects an empty description or one that repeats the file name", () => {
    expect(ids('#image("plot.png", alt: "")')).toContain("figure-alt");
    expect(ids('#image("figs/plot.png", alt: "plot.png")')).toContain("figure-alt");
  });

  it("accepts alt text on the enclosing figure from Typst 0.14 on", () => {
    const text = '#figure(image("plot.png"), caption: [Error], alt: "Line chart of error")';
    expect(ids(text, "0.14.0")).not.toContain("figure-alt");
    expect(ids(text, "0.15.1")).not.toContain("figure-alt");
  });

  it("ignores figure alt text before Typst 0.14 and says how to fix it there", () => {
    const text = '#figure(image("plot.png"), caption: [Error], alt: "Line chart of error")';
    const finding = find(text, "figure-alt", "0.13.1");
    expect(finding?.detail.key).toBe("rules.figure-alt.detailTypst");
  });

  it("ignores images in comments, raw blocks and plain words", () => {
    expect(ids('// #image("a.png")\n```typ\n#image("b.png")\n```\nThe image (left) shows it.')).not.toContain(
      "figure-alt",
    );
  });
});

describe("Typst empty-heading", () => {
  it("flags a heading marker with no title", () => {
    const text = "= Intro\nText\n==\nMore\n=== <empty>\n";
    const findings = runTypstSourceRules(text).filter((finding) => finding.id === "empty-heading");
    expect(findings).toHaveLength(2);
    expect(text.slice(findings[0].from, findings[0].to)).toBe("==");
    expect(findings[0].lens).toBe("a11y");
  });

  it("flags an empty heading call", () => {
    expect(ids("#heading[]\n#heading(level: 2, [])")).toEqual(["empty-heading", "empty-heading"]);
  });

  it("accepts a heading whose title comes from code", () => {
    expect(ids("= #title\n== Results <sec:results>")).not.toContain("empty-heading");
  });

  it("does not read assignments or raw text as headings", () => {
    expect(ids("#let x = 1\n```\n=\n```\n$ a = b $")).not.toContain("empty-heading");
  });
});

describe("Typst todo-in-text", () => {
  it("flags draft notes that print in the PDF", () => {
    const text = "Results are TODO.\n#text(red)[FIXME check] and TBD.";
    const findings = runTypstSourceRules(text).filter((finding) => finding.id === "todo-in-text");
    expect(findings.map((finding) => text.slice(finding.from, finding.to))).toEqual(["TODO", "FIXME", "TBD"]);
    expect(findings[0].lens).toBe("submission");
  });

  it("leaves comments, raw text, strings and lowercase words alone", () => {
    expect(ids('// TODO later\n`TODO`\n#let note = "TODO"\nA todo list.')).not.toContain("todo-in-text");
  });
});

describe("Typst privacy-local-path", () => {
  it("flags paths into a home folder or a drive", () => {
    const text = '#image("/Users/jane/Desktop/plot.png", alt: "Plot")\n#include "C:\\\\Users\\\\jane\\\\ch.typ"\n#bibliography("~/refs.bib")';
    const findings = runTypstSourceRules(text).filter((finding) => finding.id === "privacy-local-path");
    expect(findings).toHaveLength(3);
    expect(findings[0].lens).toBe("privacy");
    expect(text.slice(findings[0].from, findings[0].to)).toBe("/Users/jane/Desktop/plot.png");
    expect(findings[0].title.params).toEqual({ path: "/Users/jane/Desktop/plot.png" });
  });

  it("accepts paths from the project root", () => {
    expect(ids('#image("/figures/plot.png", alt: "Plot")\n#include "chapters/a.typ"')).not.toContain(
      "privacy-local-path",
    );
  });
});

describe("Typst document metadata", () => {
  const metadata = (sources: string[], anonymousReview = false) =>
    typstMetadataFindings(
      sources.map((content, index) => ({ path: index === 0 ? "main.typ" : `part${index}.typ`, content })),
      { anonymousReview },
    ).map((finding) => finding.id);

  it("asks for a title and an author", () => {
    expect(metadata(["= Intro"])).toEqual(["no-title", "no-author"]);
  });

  it("accepts set document in any project file", () => {
    expect(metadata(['#import "part1.typ": *', '#set document(title: "Paper", author: ("A", "B"))'])).toEqual([]);
  });

  it("accepts a template that takes the title and authors", () => {
    expect(metadata(['#show: ieee.with(\n  title: [Paper],\n  authors: ((name: "A"),),\n)'])).toEqual([]);
  });

  it("accepts metadata passed to a function imported from a template package", () => {
    const content = '#import "@preview/approximate-acmsmall:0.2.0": acmart\n#let acmart = acmart(\n  title: "Paper",\n  authors: ((name: "A"),),\n)\n#show: acmart.show_';
    expect(metadata([content])).toEqual([]);
  });

  it("does not take an outline title for the document title", () => {
    expect(metadata(['#set document(author: "A")\n#outline(title: [Contents])'])).toEqual(["no-title"]);
  });

  it("accepts language-specific title and author arguments on a template", () => {
    expect(metadata(['#show: jaconf.with(title-en: [Paper], authors-en: [A])'])).toEqual([]);
    expect(metadata(['#show: conf.with(titlepage: true, author: "A")'])).toEqual(["no-title"]);
  });

  it("treats an empty title as missing", () => {
    expect(metadata(['#set document(title: "", author: "A")'])).toEqual(["no-title"]);
  });

  it("does not ask for an author during anonymous review", () => {
    expect(metadata(["= Intro"], true)).toEqual(["no-title"]);
  });

  it("explains the fix in Typst terms", () => {
    const [title] = typstMetadataFindings([{ path: "main.typ", content: "" }], { anonymousReview: true });
    expect(title.detail.key).toBe("rules.no-title.detailTypst");
    expect(title.lens).toBe("a11y");
  });
});
