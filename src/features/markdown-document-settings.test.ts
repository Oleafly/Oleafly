import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applySettingEdits } from "./document-settings";
import {
  markdownSettingsEdits,
  readMarkdownDocumentSettings,
  validateMarkdownSetting,
  type MarkdownSettingChanges,
} from "./markdown-document-settings";

function edited(text: string, changes: MarkdownSettingChanges): string {
  return applySettingEdits(text, markdownSettingsEdits(text, changes));
}

function front(...lines: string[]): string {
  return ["---", ...lines, "---", "", "# Intro", "", "Body.", ""].join("\n");
}

const FULL = front(
  'title: "A study"  # main title',
  "author:",
  "  - Ada",
  "  - Grace",
  "# layout",
  "documentclass: article",
  "classoption: [a4paper, twocolumn]",
  "geometry: margin=2cm",
  "fontsize: 11pt",
  'mainfont: "TeX Gyre Pagella"',
  "lang: en-GB",
  "linestretch: 1.5",
  "numbersections: true",
  "custom: keep me",
);

describe("readMarkdownDocumentSettings", () => {
  it("reads every supported front matter field", () => {
    const settings = readMarkdownDocumentSettings(FULL);
    expect(settings.frontMatter).toBe("present");
    expect(settings.fields).toEqual({
      documentClass: { status: "set", value: "article" },
      paper: { status: "unset" },
      columns: { status: "set", value: "twocolumn" },
      margin: { status: "set", value: "2cm" },
      font: { status: "set", value: "TeX Gyre Pagella" },
      fontSize: { status: "set", value: "11pt" },
      lang: { status: "set", value: "en-GB" },
      lineSpacing: { status: "set", value: "1.5" },
      numberSections: { status: "set", value: "true" },
    });
  });

  it("reports a missing front matter", () => {
    const settings = readMarkdownDocumentSettings("# Title\n\nBody\n");
    expect(settings.frontMatter).toBe("absent");
    expect(Object.values(settings.fields).every((field) => field.status === "unset")).toBe(true);
  });

  it("reports a front matter that never closes", () => {
    const text = "---\ntitle: Draft\n\n# Title\n";
    expect(readMarkdownDocumentSettings(text).frontMatter).toBe("unclosed");
    expect(markdownSettingsEdits(text, { fontSize: "12pt" })).toEqual([]);
  });

  it("reads the conversion fixture", () => {
    const text = readFileSync(join(process.cwd(), "fixtures/conversion-matrix/math-citations.md"), "utf8");
    const settings = readMarkdownDocumentSettings(text);
    expect(settings.frontMatter).toBe("present");
    expect(settings.fields.fontSize).toEqual({ status: "unset" });
  });

  it("reads lists, quoted values and yes/no booleans", () => {
    const { fields } = readMarkdownDocumentSettings(
      front(
        "classoption:",
        "  - landscape",
        "  - twocolumn",
        "geometry:",
        "- top=2cm",
        "- margin=1in",
        "mainfont: 'Libertinus Serif'",
        "numbersections: yes",
        "papersize: a4 # ISO",
      ),
    );
    expect(fields.columns).toEqual({ status: "set", value: "twocolumn" });
    expect(fields.margin).toEqual({ status: "set", value: "1in" });
    expect(fields.font).toEqual({ status: "set", value: "Libertinus Serif" });
    expect(fields.numberSections).toEqual({ status: "set", value: "true" });
    expect(fields.paper).toEqual({ status: "set", value: "a4" });
  });

  it("locks values it cannot edit", () => {
    const { fields } = readMarkdownDocumentSettings(
      front("mainfont: |", "  Inter", "lang: {code: en}", "geometry: [left=2cm, right=3cm]", "fontsize: &size 11pt"),
    );
    expect(fields.font).toMatchObject({ status: "locked", reason: "expression" });
    expect(fields.lang).toMatchObject({ status: "locked", reason: "expression" });
    expect(fields.margin).toEqual({ status: "locked", reason: "sides", source: "left=2cm, right=3cm" });
    expect(fields.fontSize).toMatchObject({ status: "locked", reason: "expression" });
  });

  it.each([
    [String.raw`mainfont: "A \"B\" \u0041\\ C"`, { status: "set", value: String.raw`A "B" A\ C` }],
    ["mainfont: 'It''s here' # note", { status: "set", value: "It's here" }],
    ['mainfont: "Inter"   ', { status: "set", value: "Inter" }],
    [String.raw`mainfont: "\q"`, { status: "locked", reason: "expression", source: String.raw`"\q"` }],
    ['mainfont: "Inter', { status: "locked", reason: "expression", source: '"Inter' }],
    ["mainfont: 'Inter", { status: "locked", reason: "expression", source: "'Inter" }],
    ['mainfont: "Inter" Bold', { status: "locked", reason: "expression", source: '"Inter" Bold' }],
    ["mainfont: 'Inter'x", { status: "locked", reason: "expression", source: "'Inter'x" }],
    [String.raw`mainfont: "Inter\"`, { status: "locked", reason: "expression", source: String.raw`"Inter\"` }],
    ["mainfont: ''", { status: "set", value: "" }],
  ])("reads the quoted scalar %j", (line, state) => {
    expect(readMarkdownDocumentSettings(front(line)).fields.font).toEqual(state);
  });

  it("handles a byte order mark and Windows line endings", () => {
    const text = "﻿---\r\nfontsize: 11pt\r\nlang: de\r\n---\r\n\r\nText\r\n";
    const settings = readMarkdownDocumentSettings(text);
    expect(settings.fields.fontSize).toEqual({ status: "set", value: "11pt" });
    expect(settings.fields.lang).toEqual({ status: "set", value: "de" });
    expect(edited(text, { fontSize: "12pt" })).toBe("﻿---\r\nfontsize: 12pt\r\nlang: de\r\n---\r\n\r\nText\r\n");
  });
});

describe("markdownSettingsEdits", () => {
  it("adds several keys to front matter saved with Windows line endings", () => {
    for (const bom of ["", "\uFEFF"]) {
      const text = `${bom}---\r\ntitle: x\r\n---\r\n\r\nBody\r\n`;
      expect(edited(text, { paper: "a4", lineSpacing: "1.5" })).toBe(
        `${bom}---\r\ntitle: x\r\npapersize: a4\r\nlinestretch: 1.5\r\n---\r\n\r\nBody\r\n`,
      );
    }
  });

  it("edits values in place and keeps comments, quotes, unknown keys and order", () => {
    const next = edited(FULL, {
      fontSize: "12pt",
      font: "Libertinus Serif",
      columns: "onecolumn",
      margin: "1in",
      lineSpacing: "2",
      numberSections: "false",
      paper: "letter",
    });
    expect(next).toBe(
      front(
        'title: "A study"  # main title',
        "author:",
        "  - Ada",
        "  - Grace",
        "# layout",
        "documentclass: article",
        "classoption: [a4paper, onecolumn]",
        "geometry: margin=1in",
        "fontsize: 12pt",
        'mainfont: "Libertinus Serif"',
        "lang: en-GB",
        "linestretch: 2",
        "numbersections: false",
        "custom: keep me",
        "papersize: letter",
      ),
    );
  });

  it("creates a front matter when there is none", () => {
    expect(edited("# Title\n\nBody\n", { fontSize: "11pt", columns: "twocolumn" })).toBe(
      "---\nclassoption: twocolumn\nfontsize: 11pt\n---\n\n# Title\n\nBody\n",
    );
    expect(edited("﻿# Title\n", { lang: "fr" })).toBe("﻿---\nlang: fr\n---\n\n# Title\n");
  });

  it("removes keys and list items without leaving empty entries", () => {
    expect(edited(FULL, { fontSize: null, margin: null, numberSections: null, columns: null })).toBe(
      front(
        'title: "A study"  # main title',
        "author:",
        "  - Ada",
        "  - Grace",
        "# layout",
        "documentclass: article",
        "classoption: [a4paper]",
        'mainfont: "TeX Gyre Pagella"',
        "lang: en-GB",
        "linestretch: 1.5",
        "custom: keep me",
      ),
    );
    expect(edited(front("classoption: [twocolumn]", "title: T"), { columns: null })).toBe(front("title: T"));
    expect(edited(front("classoption:", "  - twocolumn", "  - landscape", "title: T"), { columns: null })).toBe(
      front("classoption:", "  - landscape", "title: T"),
    );
    expect(edited(front("classoption:", "  - twocolumn", "title: T"), { columns: null })).toBe(front("title: T"));
  });

  it("adds columns to the class options in their existing form", () => {
    expect(edited(front("classoption: landscape"), { columns: "twocolumn" })).toBe(front("classoption: [landscape, twocolumn]"));
    expect(edited(front("classoption: []"), { columns: "twocolumn" })).toBe(front("classoption: [twocolumn]"));
    expect(edited(front("classoption:", "  - landscape"), { columns: "twocolumn" })).toBe(
      front("classoption:", "  - landscape", "  - twocolumn"),
    );
    expect(edited(front("classoption:", "  - twocolumn"), { columns: "onecolumn" })).toBe(front("classoption:", "  - onecolumn"));
  });

  it("edits the margin inside geometry strings and lists", () => {
    expect(edited(front("geometry: a4paper, margin=2cm"), { margin: "1in" })).toBe(front("geometry: a4paper, margin=1in"));
    expect(edited(front('geometry: "a4paper"'), { margin: "2cm" })).toBe(front('geometry: "a4paper, margin=2cm"'));
    expect(edited(front("geometry:", "- top=2cm", "- margin=1in"), { margin: "3cm" })).toBe(
      front("geometry:", "- top=2cm", "- margin=3cm"),
    );
    expect(edited(front("geometry:", "  - landscape"), { margin: "3cm" })).toBe(
      front("geometry:", "  - landscape", "  - margin=3cm"),
    );
    expect(edited(front("geometry: a4paper, margin=2cm"), { margin: null })).toBe(front("geometry: a4paper"));
    expect(edited(front("geometry: [left=2cm, right=3cm]"), { margin: "1cm" })).toBe(front("geometry: [left=2cm, right=3cm]"));
  });

  it("edits class options in every form it reads", () => {
    expect(edited(front("classoption: twocolumn"), { columns: null })).toBe(front());
    expect(edited(front("classoption: twocolumn"), { columns: "onecolumn" })).toBe(front("classoption: onecolumn"));
    expect(edited(front("classoption:", "title: T"), { columns: "twocolumn" })).toBe(front("classoption: twocolumn", "title: T"));
    expect(edited(front("classoption: a4paper,landscape"), { columns: "twocolumn" })).toBe(front("classoption: a4paper,landscape"));
    expect(edited(front("classoption: landscape"), { columns: null })).toBe(front("classoption: landscape"));
    expect(edited(front("classoption: {a: b}"), { columns: "twocolumn" })).toBe(front("classoption: {a: b}"));
    expect(edited(front("classoption: [landscape]"), { columns: null })).toBe(front("classoption: [landscape]"));
    expect(edited(front("classoption: [twocolumn, landscape, onecolumn]"), { columns: "twocolumn" })).toBe(
      front("classoption: [twocolumn, landscape, twocolumn]"),
    );
    expect(edited(front("classoption: [twocolumn, landscape, onecolumn]"), { columns: null })).toBe(
      front("classoption: [twocolumn, landscape]"),
    );
  });

  it("edits geometry margins in every form it reads", () => {
    expect(edited(front("geometry:", "title: T"), { margin: "2cm" })).toBe(front("geometry: margin=2cm", "title: T"));
    expect(edited(front("geometry: margin=2cm", "title: T"), { margin: null })).toBe(front("title: T"));
    expect(edited(front('geometry: "margin=2cm"'), { margin: "1in" })).toBe(front('geometry: "margin=1in"'));
    expect(edited(front("geometry: 'a4paper'"), { margin: "1in" })).toBe(front("geometry: 'a4paper, margin=1in'"));
    expect(edited(front("geometry: a4paper,landscape"), { margin: "2cm" })).toBe(front("geometry: a4paper,landscape,margin=2cm"));
    expect(edited(front("geometry: a4paper"), { margin: null })).toBe(front("geometry: a4paper"));
    expect(edited(front("geometry: {a: b}"), { margin: "2cm" })).toBe(front("geometry: {a: b}"));
    expect(edited(front("geometry:", "  - margin=1cm", "  - landscape"), { margin: null })).toBe(front("geometry:", "  - landscape"));
    expect(edited(front("geometry:", "  - margin=1cm"), { margin: null })).toBe(front());
    expect(edited(front("geometry: [landscape]"), { margin: null })).toBe(front("geometry: [landscape]"));
    expect(edited(front("geometry: ['margin=1cm', landscape]"), { margin: "2cm" })).toBe(front("geometry: ['margin=2cm', landscape]"));
    expect(edited(front("geometry: [landscape]"), { margin: "2cm" })).toBe(front("geometry: [landscape, margin=2cm]"));
    expect(edited(front("geometry:", "  - landscape", "title: T"), { margin: "2cm" })).toBe(
      front("geometry:", "  - landscape", "  - margin=2cm", "title: T"),
    );
  });

  it("fills an empty value after its key", () => {
    expect(edited(front("fontsize:", "lang: en"), { fontSize: "10pt" })).toBe(front("fontsize: 10pt", "lang: en"));
  });

  it("quotes strings that YAML would misread", () => {
    expect(edited(front("title: T"), { font: "Font: Special" })).toBe(front("title: T", 'mainfont: "Font: Special"'));
    expect(edited(front("title: T"), { font: "#1 Serif" })).toBe(front("title: T", 'mainfont: "#1 Serif"'));
  });

  it("skips locked and invalid values", () => {
    expect(markdownSettingsEdits(front("mainfont: |", "  Inter"), { font: "Other" })).toEqual([]);
    expect(markdownSettingsEdits(FULL, { margin: "wide", lang: "en_GB", lineSpacing: "double" })).toEqual([]);
  });
});

describe("validateMarkdownSetting", () => {
  it("accepts pandoc values and rejects the rest", () => {
    expect(validateMarkdownSetting("paper", "a4")).toBe(true);
    expect(validateMarkdownSetting("paper", "a4paper")).toBe(false);
    expect(validateMarkdownSetting("margin", "2.5cm")).toBe(true);
    expect(validateMarkdownSetting("fontSize", "11pt")).toBe(true);
    expect(validateMarkdownSetting("lang", "en-US")).toBe(true);
    expect(validateMarkdownSetting("lang", "en_US")).toBe(false);
    expect(validateMarkdownSetting("lineSpacing", "1.25")).toBe(true);
    expect(validateMarkdownSetting("lineSpacing", "wide")).toBe(false);
    expect(validateMarkdownSetting("numberSections", "true")).toBe(true);
    expect(validateMarkdownSetting("documentClass", "scrartcl")).toBe(true);
    expect(validateMarkdownSetting("documentClass", "my class")).toBe(false);
    expect(validateMarkdownSetting("font", "Inter\nBold")).toBe(false);
  });
});
