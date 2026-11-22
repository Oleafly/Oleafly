import { describe, expect, it } from "vitest";
import type { PdfAnnotation } from "@/lib/tauri";
import {
  annotationLabel,
  annotationPrompt,
  currentSource,
  followSource,
  sectionHeading,
  sourceExcerpt,
} from "./model";

function annotation(patch: Partial<PdfAnnotation> = {}): PdfAnnotation {
  return {
    id: "a1",
    number: 3,
    kind: "comment",
    comment: "Say why this matters.",
    quote: { text: "the result holds", before: "We show that ", after: " for every n" },
    page: 4,
    source: { path: "chapters/intro.tex", startLine: 3, endLine: 4, excerpt: "We show that\nthe result holds" },
    boxes: [],
    build: null,
    origin: "pdf",
    status: "draft",
    placement: "placed",
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

const TEXT = "\\section{Introduction}\n\nWe show that\nthe result holds\nfor every n.\n";

describe("sourceExcerpt", () => {
  it("takes the lines in either order and stops at the end of the file", () => {
    expect(sourceExcerpt("a\nb\nc", 3, 2)).toBe("b\nc");
    expect(sourceExcerpt("a\nb", 2, 9)).toBe("b");
    expect(sourceExcerpt("a", 5, 6)).toBe("");
  });
});

describe("followSource", () => {
  it("follows an edited block to its nearest copy, not an earlier block with the same delimiters", () => {
    const earlier = ["\\begin{equation}", "a = b", "\\end{equation}"];
    const filler = Array.from({ length: 100 }, (_, index) => `Line ${index} of the proof.`);
    const edited = ["\\begin{equation}", "E = m c^2 + k", "\\end{equation}"];
    const text = [...earlier, ...filler, ...edited, "After."].join("\n");
    const block = { path: "main.tex", startLine: 104, endLine: 106, excerpt: "\\begin{equation}\nE = mc^2\n\\end{equation}" };
    expect(followSource(block, text)).toMatchObject({ startLine: 104, endLine: 106 });
  });

  const source = { path: "main.tex", startLine: 3, endLine: 4, excerpt: "We show that\nthe result holds" };

  it("keeps the lines when nothing moved", () => {
    expect(followSource(source, TEXT)).toEqual(source);
  });

  it("follows the lines when text is added above them", () => {
    expect(followSource(source, `% new\n% lines\n${TEXT}`)).toEqual({ ...source, startLine: 5, endLine: 6 });
  });

  it("picks the copy nearest the old lines", () => {
    const text = "We show that\nthe result holds\nx\ny\nWe show that\nthe result holds\n";
    expect(followSource({ ...source, startLine: 5, endLine: 6 }, text)).toMatchObject({ startLine: 5 });
    expect(followSource({ ...source, startLine: 1, endLine: 2 }, text)).toMatchObject({ startLine: 1 });
  });

  it("returns null when the lines are gone", () => {
    expect(followSource(source, "\\section{Introduction}\nSomething else\n")).toBeNull();
  });

  it("follows a long range when a line inside it is edited", () => {
    const before = Array.from({ length: 30 }, (_, index) => `line number ${index + 1} of the figure`);
    const long = { path: "main.tex", startLine: 11, endLine: 40, excerpt: before.join("\n") };
    const edited = [...before];
    edited[14] = "an edited line that is new";
    const text = ["% a", "% b", ...Array.from({ length: 10 }, (_, index) => `head ${index}`), ...edited].join("\n");
    expect(followSource(long, text)).toMatchObject({ startLine: 13, endLine: 42 });
  });

  it("grows the range when lines are added inside it", () => {
    const text = "x\ny\nWe show that\n% inserted\n% more\nthe result holds\n";
    expect(followSource({ ...source, startLine: 3, endLine: 4 }, text)).toMatchObject({ startLine: 3, endLine: 6 });
  });

  it("keeps the full span when the stored excerpt was cut short", () => {
    const text = Array.from({ length: 200 }, (_, index) => `distinct line ${index + 1}`).join("\n");
    const cut = { path: "main.tex", startLine: 50, endLine: 149, excerpt: sourceExcerpt(text, 50, 149) };
    expect(followSource(cut, `new\n${text}`)).toMatchObject({ startLine: 51, endLine: 150 });
  });

  it("finds a rewritten paragraph by its words near the old place", () => {
    const paragraph = { path: "main.tex", startLine: 2, endLine: 2, excerpt: "In this work we employ h = 8 parallel attention heads." };
    const text = "intro\nfiller\nIn this work we use h = 16 parallel attention heads.\nend\n";
    expect(followSource(paragraph, text)).toMatchObject({ startLine: 3, endLine: 3 });
  });

  it("ignores trailing spaces and CRLF", () => {
    expect(followSource(source, "a\r\nb\r\nWe show that  \r\nthe result holds\r\n")).toMatchObject({ startLine: 3 });
  });
});

describe("sectionHeading", () => {
  it("finds the heading above a line in LaTeX, Typst and Markdown", () => {
    expect(sectionHeading("a.tex", TEXT, 4)).toBe("Introduction");
    expect(sectionHeading("a.tex", "\\subsection*[Short]{Long title}\ntext", 2)).toBe("Long title");
    expect(sectionHeading("a.typ", "= Results\n\ntext", 3)).toBe("Results");
    expect(sectionHeading("a.md", "## Method ##\ntext", 2)).toBe("Method");
    expect(sectionHeading("a.bib", "@article{x,}", 1)).toBeNull();
    expect(sectionHeading("a.tex", "text\nmore", 2)).toBeNull();
  });
});

describe("annotationLabel", () => {
  it("names the note, the file and its lines", () => {
    expect(annotationLabel(annotation())).toBe("3 · intro.tex:3-4");
    expect(annotationLabel(annotation({ source: null }))).toBe("3");
  });
});

describe("annotationPrompt", () => {
  it("says where the note is, the exact selection, what is asked and the source", () => {
    const note = annotation();
    const prompt = annotationPrompt(note, currentSource(note, `% one\n${TEXT}`));
    expect(prompt).toContain("Note 3 on the compiled PDF");
    expect(prompt).toContain('Location: chapters/intro.tex:4-5 (page 4), in "Introduction".');
    expect(prompt).toContain('Selected text: "the result holds"');
    expect(prompt).toContain("On the PDF, in brackets: …We show that [the result holds] for every n…");
    expect(prompt).toContain("Asked: The comment is about the selected text.");
    expect(prompt).toContain("Comment: Say why this matters.");
    expect(prompt).toContain("Source lines that hold the selected text");
    expect(prompt).toContain("```latex\nWe show that\nthe result holds\n```");
  });

  it("asks to change only the selected words, with the new text exactly as typed", () => {
    const replace = annotation({
      kind: "replace",
      comment: "The",
      quote: { text: "this", before: "commands are allowed for ", after: " project." },
    });
    const prompt = annotationPrompt(replace, currentSource(replace, null));
    expect(prompt).toContain('Selected text: "this"');
    expect(prompt).toContain("…commands are allowed for [this] project.…");
    expect(prompt).toContain("Asked: Replace only the selected text with the replacement. Keep the words around it.");
    expect(prompt).toContain('Replacement: "The"');
    expect(prompt).not.toContain("Comment:");

    const insert = annotation({ kind: "insert", comment: ":", quote: { text: "command", before: "", after: "" } });
    const inserted = annotationPrompt(insert, currentSource(insert, null));
    expect(inserted).toContain("Asked: Insert the new text right after the selected text. Change nothing else.");
    expect(inserted).toContain('New text: ":"');
    expect(inserted).toContain("On the PDF, in brackets: [command]");
  });

  it("says so when the lines are gone", () => {
    const note = annotation({ kind: "delete", comment: "" });
    const prompt = annotationPrompt(note, currentSource(note, "nothing here\n"));
    expect(prompt).toContain("are no longer in the file");
    expect(prompt).toContain("Asked: Delete only the selected text. Keep the words around it.");
    expect(prompt).not.toContain("Comment:");
    expect(prompt).not.toContain("```");
  });

  it("says so when the file could not be checked", () => {
    const note = annotation();
    expect(annotationPrompt(note, currentSource(note, null))).toContain("were not checked again");
  });

  it("handles a region note with no source and no text", () => {
    const note = annotation({ source: null, kind: "region", quote: { text: "", before: "", after: "" } });
    const prompt = annotationPrompt(note, currentSource(note, null));
    expect(prompt).toContain("Location: page 4. No source location was found.");
    expect(prompt).toContain("Asked: The comment is about the marked region of the page");
    expect(prompt).toContain("No text was read from inside the region.");
    expect(prompt).not.toContain("Selected text");
  });

  it("describes a region by its place on the page, the lines around it and the text inside it", () => {
    const note = annotation({
      kind: "region",
      comment: "What is this?",
      quote: { text: "def greet(name):\nreturn f\"Hello, {name}!\"", before: "Highlighted code", after: "Next section" },
      boxes: [{ page: 4, x: 79.6, y: 300.2, width: 240, height: 24.4 }],
      source: { path: "main.tex", startLine: 9, endLine: 10, excerpt: "def greet(name):\n    return f\"Hello, {name}!\"" },
    });
    const prompt = annotationPrompt(note, currentSource(note, null));
    expect(prompt).toContain("Region: page 4, x 80 to 320 pt and y 300 to 325 pt from the top-left corner of the page.");
    expect(prompt).toContain('Just above the region on the PDF: "Highlighted code"');
    expect(prompt).toContain('Text inside the region on the PDF:\n```\ndef greet(name):\nreturn f"Hello, {name}!"\n```');
    expect(prompt).toContain('Just below the region on the PDF: "Next section"');
    expect(prompt).toContain("Comment: What is this?");
    expect(prompt).toContain("Source lines that hold the region's text");
    expect(prompt).not.toContain("Selected text");
  });
});
