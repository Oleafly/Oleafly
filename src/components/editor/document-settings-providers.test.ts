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

const typstSettings = enEditor.typstSettings;
const typst = documentSettingsProvider("typst", "main.typ");

describe("choosing a provider", () => {
  it("follows the engine and then the main file", () => {
    expect(documentSettingsProvider("typst", "main.tex").id).toBe("typst");
    expect(documentSettingsProvider("latexmk", "main.typ").id).toBe("latex");
    expect(documentSettingsProvider("markdown", "main.tex").id).toBe("markdown");
    expect(documentSettingsProvider(undefined, "thesis.LTX").id).toBe("latex");
    expect(documentSettingsProvider("pandoc", "notes.markdown").id).toBe("markdown");
    expect(documentSettingsProvider(undefined, "slides.key").id).toBe("typst");
  });

  it("describes each engine's main file", () => {
    expect(typst.description("main.typ")).toBe(typstSettings.description.replace("{{file}}", "main.typ"));
    expect(typst.noMainFile()).toBe(typstSettings.noMainFile);
    expect(latex.noMainFile()).toBe(settings.noLatexMainFile);
    expect(markdown.noMainFile()).toBe(settings.noMarkdownMainFile);
  });
});

describe("locked setting messages", () => {
  it.each([
    ["template", undefined, typstSettings.locked.template],
    ["class", "IEEEtran", settings.locked.class.replace("{{name}}", "IEEEtran")],
    ["package", "neurips_2024", settings.locked.package.replace("{{name}}", "neurips_2024")],
    ["engine", undefined, settings.locked.engine],
    ["sides", undefined, settings.locked.sides],
    ["conditional", undefined, settings.locked.conditional],
    ["expression", undefined, typstSettings.locked.expression],
  ])("explains a setting locked by %s", (reason, owner, expected) => {
    const state = { status: "locked" as const, reason, source: "", ...(owner ? { owner } : {}) };
    expect(latex.locked(state)).toBe(expected);
    expect(typst.locked(state)).toBe(expected);
  });
});

describe("field hints", () => {
  it.each([
    ["margin", typstSettings.invalid.margin],
    ["columns", typstSettings.invalid.columns],
    ["lang", typstSettings.invalid.lang],
    ["region", typstSettings.invalid.region],
    ["fontSize", typstSettings.invalid.length],
  ])("explains an invalid Typst %s", (key, expected) => {
    expect(typst.invalid(key)).toBe(expected);
  });

  it("offers Typst placeholders only for free-form fields", () => {
    expect(typst.placeholder("region")).toBe(typstSettings.placeholders.region);
    expect(typst.placeholder("paper")).toBeUndefined();
  });

  it.each([
    ["font", settings.invalid.fontName, settings.invalid.fontName],
    ["lang", settings.invalid.latexLang, settings.invalid.markdownLang],
    ["lineSpacing", settings.invalid.lineStretch, settings.invalid.lineStretch],
    ["margin", settings.invalid.length, settings.invalid.length],
  ])("explains an invalid LaTeX or Markdown %s", (key, latexMessage, markdownMessage) => {
    expect(latex.invalid(key)).toBe(latexMessage);
    expect(markdown.invalid(key)).toBe(markdownMessage);
  });

  it.each([
    ["margin", typstSettings.placeholders.margin, typstSettings.placeholders.margin],
    ["font", typstSettings.placeholders.font, typstSettings.placeholders.font],
    ["lang", settings.placeholders.latexLang, settings.placeholders.markdownLang],
    ["lineSpacing", settings.placeholders.lineStretch, settings.placeholders.lineStretch],
    ["paper", undefined, undefined],
  ])("suggests a LaTeX or Markdown %s", (key, latexHint, markdownHint) => {
    expect(latex.placeholder(key)).toBe(latexHint);
    expect(markdown.placeholder(key)).toBe(markdownHint);
  });
});

describe("LaTeX preamble notices", () => {
  it("names the class or style that owns the layout and an external preamble", async () => {
    const source = [
      String.raw`\documentclass{IEEEtran}`,
      String.raw`\usepackage[final]{neurips_2024}`,
      String.raw`\input{preamble}`,
      String.raw`\begin{document}`,
      String.raw`\end{document}`,
    ].join("\n");
    await expect(latex.read(source, { engineId: "latex" })).resolves.toMatchObject({
      status: "ready",
      notices: [
        settings.classNotice.replace("{{name}}", "IEEEtran"),
        settings.styleNotice.replace("{{name}}", "neurips_2024"),
        settings.externalPreamble,
      ],
    });
  });
});
