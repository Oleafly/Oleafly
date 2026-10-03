import { describe, expect, it } from "vitest";
import enEditor from "@/i18n/locales/en/editor.json" with { type: "json" };
import { documentSettingsProvider } from "./document-settings-providers";

const settings = enEditor.documentSettings;
const options = settings.options;
const latex = documentSettingsProvider("latex", "main.tex");
const markdown = documentSettingsProvider("markdown", "main.md");
const LATEX_SOURCE = [String.raw`\documentclass[11pt]{article}`, String.raw`\begin{document}`, String.raw`\end{document}`, ""].join("\n");

describe("shared document setting options", () => {
  it.each([
    ["columns", "onecolumn", options.onecolumn],
    ["columns", "twocolumn", options.twocolumn],
    ["columns", "single", "single"],
    ["lineSpacing", "single", options.single],
    ["lineSpacing", "onehalf", options.onehalf],
    ["lineSpacing", "double", options.double],
    ["lineSpacing", "triple", "triple"],
    ["equationNumbering", "section", options.bySection],
    ["equationNumbering", "chapter", options.byChapter],
    ["equationNumbering", "subsection", options.bySubsection],
    ["equationNumbering", "true", "true"],
    ["numberSections", "true", options.numbered],
    ["numberSections", "false", options.unnumbered],
    ["numberSections", "section", "section"],
    ["secnumdepth", "-1", options.depthNone],
    ["secnumdepth", "0", options.depthChapters],
    ["secnumdepth", "3", options.depthSubsubsections],
    ["secnumdepth", "5", options.depthSubparagraphs],
    ["secnumdepth", "9", "9"],
    ["secnumdepth", "onecolumn", "onecolumn"],
    ["paper", "onecolumn", "onecolumn"],
    ["fontSize", "11pt", "11pt"],
    ["constructor", "toString", "toString"],
  ])("labels %s = %s", (key, option, expected) => {
    expect(latex.option(key, option)).toBe(expected);
    expect(markdown.option(key, option)).toBe(expected);
  });
});

describe("LaTeX and Markdown provider reads and edits", () => {
  it("reads a LaTeX preamble", async () => {
    const read = latex.read(LATEX_SOURCE, {});
    expect(read).toBeInstanceOf(Promise);
    await expect(read).resolves.toMatchObject({ status: "ready", notices: [] });
  });

  it("reports a LaTeX file without a document class", async () => {
    await expect(latex.read("Hello", {})).resolves.toEqual({ status: "error", message: settings.noDocumentClass });
  });

  it("returns LaTeX edits", async () => {
    const edits = latex.edits(LATEX_SOURCE, { fontSize: "12pt" }, {});
    expect(edits).toBeInstanceOf(Promise);
    await expect(edits).resolves.not.toHaveLength(0);
  });

  it("reports unclosed Markdown front matter", async () => {
    await expect(markdown.read("---\ntitle: x\n", {})).resolves.toEqual({
      status: "error",
      message: settings.unclosedFrontMatter,
    });
  });

  it("notes missing Markdown front matter", async () => {
    await expect(markdown.read("# Title\n", {})).resolves.toMatchObject({
      status: "ready",
      notices: [settings.noFrontMatter],
    });
  });

  it("returns Markdown edits", async () => {
    const edits = markdown.edits("---\ntitle: x\n---\n", { fontSize: "12pt" }, {});
    expect(edits).toBeInstanceOf(Promise);
    await expect(edits).resolves.not.toHaveLength(0);
  });
});
