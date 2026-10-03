import { describe, expect, it } from "vitest";
import {
  applyTypstEdits,
  parseTypstSource,
  readTypstDocumentSettings,
  typstSettingsEdits,
  validateTypstSetting,
  type TypstSettingChanges,
} from "./typst-document-settings";

async function settingsOf(text: string) {
  return readTypstDocumentSettings(text, await parseTypstSource(text));
}

async function edited(text: string, changes: TypstSettingChanges): Promise<string> {
  const edits = typstSettingsEdits(text, await parseTypstSource(text), changes);
  return applyTypstEdits(text, edits);
}

const PAPER = [
  '#import "lib.typ": conf',
  '#set page(paper: "a4", margin: (x: 2cm, y: 3cm), columns: 2)',
  '#set text(font: "Libertinus Serif", size: 11pt, lang: "de", region: "AT")',
  "#set par(justify: true, leading: 0.6em)",
  '#set heading(numbering: "1.1")',
  "#set math.equation(numbering: none)",
  "= Intro",
  "",
].join("\n");

describe("readTypstDocumentSettings", () => {
  it("reads every supported argument from the top-level set rules", async () => {
    const { fields, templateApplied } = await settingsOf(PAPER);
    expect(templateApplied).toBe(false);
    expect(fields.paper).toMatchObject({ status: "set", value: "a4" });
    expect(fields.margin).toEqual({ status: "locked", reason: "expression", source: "(x: 2cm, y: 3cm)" });
    expect(fields.columns).toMatchObject({ status: "set", value: "2" });
    expect(fields.font).toMatchObject({ status: "set", value: "Libertinus Serif" });
    expect(fields.fontSize).toMatchObject({ status: "set", value: "11pt" });
    expect(fields.lang).toMatchObject({ status: "set", value: "de" });
    expect(fields.region).toMatchObject({ status: "set", value: "AT" });
    expect(fields.justify).toMatchObject({ status: "set", value: "true" });
    expect(fields.leading).toMatchObject({ status: "set", value: "0.6em" });
    expect(fields.headingNumbering).toMatchObject({ status: "set", value: "1.1" });
    expect(fields.equationNumbering).toMatchObject({ status: "set", value: "none" });
  });

  it("reads escapes inside string values", async () => {
    const source = String.raw`#set text(font: "A\nB\tC\rD\u{1F600}\u{zz}E\"F\\G\qH")`;
    const { fields } = await settingsOf(`${source}\n`);
    expect(fields.font).toMatchObject({ status: "set", value: 'A\nB\tC\rD\u{1F600}E"F\\GqH' });
  });

  it("keeps an unterminated or out-of-range unicode escape without hanging", async () => {
    const open = await settingsOf(`${String.raw`#set text(font: "A\u{41")`}\n`);
    expect(open.fields.font).toMatchObject({ status: "set", value: String.raw`A\u{41` });
    const large = await settingsOf(`${String.raw`#set text(font: "A\u{110000}B")`}\n`);
    expect(large.fields.font).toMatchObject({ status: "set", value: "AB" });
  });

  it("lets the last rule win and reports unset fields", async () => {
    const { fields } = await settingsOf("#set text(size: 10pt)\n#set text(size: 12pt)\nBody\n");
    expect(fields.fontSize).toMatchObject({ status: "set", value: "12pt" });
    expect(fields.font).toEqual({ status: "unset" });
    expect(fields.paper).toEqual({ status: "unset" });
  });

  it("marks conditional rules and rules it cannot parse as set by the template", async () => {
    const { fields } = await settingsOf(
      '#set text(size: 9pt) if draft\n#set page(paper: "a5", ..extra)\n',
    );
    expect(fields.fontSize).toEqual({ status: "locked", reason: "template", source: "9pt" });
    expect(fields.paper).toEqual({ status: "locked", reason: "template", source: '"a5"' });
  });

  it("ignores rules nested inside functions and blocks", async () => {
    const { fields } = await settingsOf("#let conf(body) = {\n  set text(size: 9pt)\n  body\n}\n#[#set text(size: 8pt)]\n");
    expect(fields.fontSize).toEqual({ status: "unset" });
  });

  it("notices a template applied with an everything show rule", async () => {
    const { templateApplied } = await settingsOf('#import "@preview/charged-ieee:0.1.4": ieee\n#show: ieee.with(title: [T])\n');
    expect(templateApplied).toBe(true);
  });

  it("shows font lists and numbering functions as values set in the source", async () => {
    const { fields } = await settingsOf('#set text(font: ("A", "B"))\n#set heading(numbering: (..n) => none)\n');
    expect(fields.font).toEqual({ status: "locked", reason: "expression", source: '("A", "B")' });
    expect(fields.headingNumbering).toMatchObject({ status: "locked", reason: "expression" });
  });
});

describe("typstSettingsEdits", () => {
  it("updates an argument in place without touching the rest of the rule", async () => {
    expect(await edited(PAPER, { fontSize: "12pt", paper: "us-letter", equationNumbering: "(1)" })).toBe(
      PAPER.replace("size: 11pt", "size: 12pt")
        .replace('paper: "a4"', 'paper: "us-letter"')
        .replace("numbering: none", 'numbering: "(1)"'),
    );
  });

  it("adds a missing argument to the existing rule", async () => {
    expect(await edited("#set text(size: 11pt)\n", { lang: "fr" })).toBe('#set text(size: 11pt, lang: "fr")\n');
    expect(await edited("#set text()\n", { lang: "fr" })).toBe('#set text(lang: "fr")\n');
    expect(await edited("#set text(size: 11pt,)\n", { lang: "fr" })).toBe('#set text(size: 11pt, lang: "fr")\n');
  });

  it("keeps the layout of a multi-line rule when it adds an argument", async () => {
    const text = '#set page(\n  paper: "a4",\n  numbering: "1",\n)\n';
    expect(await edited(text, { columns: "2" })).toBe('#set page(\n  paper: "a4",\n  numbering: "1",\n  columns: 2,\n)\n');
    const bare = '#set page(\n  paper: "a4"\n)\n';
    expect(await edited(bare, { columns: "2" })).toBe('#set page(\n  paper: "a4",\n  columns: 2\n)\n');
  });

  it("adds one rule per element after the imports", async () => {
    const text = '#import "lib.typ": conf\n#import "util.typ": *\n\n= Intro\n';
    expect(await edited(text, { justify: "true", leading: "0.7em", headingNumbering: "1." })).toBe(
      '#import "lib.typ": conf\n#import "util.typ": *\n#set par(justify: true, leading: 0.7em)\n#set heading(numbering: "1.")\n\n= Intro\n',
    );
  });

  it("puts a new rule after the template show rule so it overrides the template", async () => {
    const text = '#import "lib.typ": conf\n#show: conf.with(\n  title: [T],\n)\n= Intro\n';
    expect(await edited(text, { fontSize: "12pt" })).toBe(
      '#import "lib.typ": conf\n#show: conf.with(\n  title: [T],\n)\n#set text(size: 12pt)\n= Intro\n',
    );
  });

  it("starts the file with the rule when there are no imports", async () => {
    expect(await edited("= Intro\n", { region: "gb" })).toBe('#set text(region: "GB")\n= Intro\n');
  });

  it("removes a cleared argument with its comma", async () => {
    expect(await edited("#set text(size: 11pt, lang: \"de\")\n", { fontSize: null })).toBe('#set text(lang: "de")\n');
    expect(await edited("#set text(size: 11pt, lang: \"de\")\n", { lang: null })).toBe("#set text(size: 11pt)\n");
    expect(await edited('#set page(\n  paper: "a4",\n  columns: 2,\n)\n', { paper: null })).toBe(
      "#set page(\n  columns: 2,\n)\n",
    );
  });

  it("escapes strings and never rewrites locked values", async () => {
    expect(await edited('#set text(font: "A")\n', { font: 'Say "Hi" \\ Sans' })).toBe(
      '#set text(font: "Say \\"Hi\\" \\\\ Sans")\n',
    );
    const locked = "#set text(size: 9pt) if draft\n";
    expect(await edited(locked, { fontSize: "12pt" })).toBe(locked);
    const expression = '#set page(margin: (x: 1cm))\n';
    expect(await edited(expression, { margin: "2cm" })).toBe(expression);
  });

  it("writes newlines and tabs in a string as Typst escapes", async () => {
    const expected = String.raw`#set text(font: "One\tTwo\nThree")`;
    expect(await edited('#set text(font: "A")\n', { font: "One\tTwo\nThree" })).toBe(`${expected}\n`);
  });

  it("removes and updates arguments in the same pass and keeps edits in source order", async () => {
    const text = '#set page(paper: "a4", columns: 2)\n#set text(size: 11pt)\n#set heading(numbering: "1.")\n';
    expect(await edited(text, { paper: null, columns: "3", fontSize: "11pt", lang: "fr", justify: "true", headingNumbering: "" })).toBe(
      '#set par(justify: true)\n#set page(columns: 3)\n#set text(size: 11pt, lang: "fr")\n#set heading()\n',
    );
  });

  it("only extends the last editable rule for an element", async () => {
    const text = "#set text(size: 9pt)\n#set text(size: 10pt) if draft\n";
    expect(await edited(text, { lang: "de" })).toBe('#set text(size: 9pt, lang: "de")\n#set text(size: 10pt) if draft\n');
  });

  it("leaves the document alone when nothing changed or a value is invalid", async () => {
    expect(await edited(PAPER, {})).toBe(PAPER);
    expect(await edited(PAPER, { fontSize: "big" })).toBe(PAPER);
  });
});

describe("validateTypstSetting", () => {
  it("accepts Typst lengths, counts, language codes and numbering patterns", () => {
    expect(validateTypstSetting("margin", "2.5cm")).toBe(true);
    expect(validateTypstSetting("margin", "auto")).toBe(true);
    expect(validateTypstSetting("fontSize", "11")).toBe(false);
    expect(validateTypstSetting("leading", "0.65em")).toBe(true);
    expect(validateTypstSetting("columns", "0")).toBe(false);
    expect(validateTypstSetting("columns", "3")).toBe(true);
    expect(validateTypstSetting("lang", "en")).toBe(true);
    expect(validateTypstSetting("lang", "english")).toBe(false);
    expect(validateTypstSetting("region", "US")).toBe(true);
    expect(validateTypstSetting("headingNumbering", "1.a")).toBe(true);
    expect(validateTypstSetting("headingNumbering", "")).toBe(false);
    expect(validateTypstSetting("font", "  ")).toBe(false);
  });
});
