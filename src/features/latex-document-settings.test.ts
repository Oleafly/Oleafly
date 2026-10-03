import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applySettingEdits } from "./document-settings";
import {
  latexSettingsEdits,
  latexSupportsSystemFonts,
  readLatexDocumentSettings,
  validateLatexSetting,
  type LatexEnvironment,
  type LatexSettingChanges,
} from "./latex-document-settings";

const UNICODE: LatexEnvironment = { unicodeFonts: true };
const PDF: LatexEnvironment = { unicodeFonts: false };

function seed(name: string): string {
  return readFileSync(join(process.cwd(), "fixtures/research-seeds", name, "main.tex"), "utf8");
}

function edited(text: string, changes: LatexSettingChanges, env: LatexEnvironment = UNICODE): string {
  return applySettingEdits(text, latexSettingsEdits(text, changes, env));
}

function doc(...preamble: string[]): string {
  return [...preamble, "\\begin{document}", "Body.", "\\end{document}", ""].join("\n");
}

const FULL = doc(
  "\\documentclass[11pt,a4paper,twocolumn]{article}",
  "\\usepackage[margin=2cm]{geometry}",
  "\\usepackage{fontspec}",
  "\\setmainfont{TeX Gyre Pagella}",
  "\\usepackage[ngerman]{babel}",
  "\\usepackage{setspace}",
  "\\onehalfspacing",
  "\\setcounter{secnumdepth}{2}",
  "\\numberwithin{equation}{section}",
);

describe("readLatexDocumentSettings", () => {
  it("reads every supported setting from the preamble and ignores the body", () => {
    const settings = readLatexDocumentSettings(`${FULL}\\doublespacing\n`, UNICODE);
    expect(settings.documentClass).toBe("article");
    expect(settings.fields).toEqual({
      paper: { status: "set", value: "a4paper" },
      fontSize: { status: "set", value: "11pt" },
      columns: { status: "set", value: "twocolumn" },
      margin: { status: "set", value: "2cm" },
      font: { status: "set", value: "TeX Gyre Pagella" },
      lang: { status: "set", value: "ngerman" },
      lineSpacing: { status: "set", value: "onehalf" },
      secnumdepth: { status: "set", value: "2" },
      equationNumbering: { status: "set", value: "section" },
    });
    expect(settings.externalPreamble).toBe(false);
    expect(settings.lockingClass).toBeNull();
  });

  it("reports unset fields for a bare document", () => {
    const { fields } = readLatexDocumentSettings(doc("\\documentclass{article}"), UNICODE);
    expect(Object.values(fields).every((field) => field.status === "unset")).toBe(true);
  });

  it("skips comments, definitions and commands inside braces", () => {
    const { fields } = readLatexDocumentSettings(
      doc(
        "\\documentclass{article} % [twocolumn]",
        "% \\usepackage[margin=1in]{geometry}",
        "\\newcommand{\\spaced}{\\doublespacing}",
        "\\let\\oldsingle\\singlespacing",
        "\\def\\onehalf{\\setcounter{secnumdepth}{1}}",
      ),
      UNICODE,
    );
    expect(fields.columns).toEqual({ status: "unset" });
    expect(fields.margin).toEqual({ status: "unset" });
    expect(fields.lineSpacing).toEqual({ status: "unset" });
    expect(fields.secnumdepth).toEqual({ status: "unset" });
  });

  it("returns no class for a file without \\documentclass", () => {
    const settings = readLatexDocumentSettings("\\section{Intro}\nText.\n", UNICODE);
    expect(settings.documentClass).toBeNull();
    expect(latexSettingsEdits("\\section{Intro}\n", { columns: "twocolumn" }, UNICODE)).toEqual([]);
  });

  it("lets geometry paper options win and locks per-side margins", () => {
    const { fields } = readLatexDocumentSettings(seed("ieee-two-column-journal-article"), UNICODE);
    expect(fields.paper).toEqual({ status: "set", value: "letterpaper" });
    expect(fields.fontSize).toEqual({ status: "set", value: "10pt" });
    expect(fields.columns).toEqual({ status: "set", value: "twocolumn" });
    expect(fields.margin).toEqual({
      status: "locked",
      reason: "sides",
      source: "top=0.75in,bottom=0.85in,left=0.62in,right=0.62in",
    });
  });

  it("reads the research seed preambles", () => {
    const neurips = readLatexDocumentSettings(seed("neurips-style-ml-preprint"), UNICODE).fields;
    expect(neurips.margin).toEqual({ status: "set", value: "1.2in" });
    expect(neurips.paper).toEqual({ status: "set", value: "letterpaper" });
    expect(neurips.fontSize).toEqual({ status: "set", value: "11pt" });
    const thesis = readLatexDocumentSettings(seed("computational-physics-phd-thesis"), UNICODE).fields;
    expect(thesis.lineSpacing).toEqual({ status: "set", value: "onehalf" });
    expect(thesis.paper).toEqual({ status: "set", value: "a4paper" });
    expect(thesis.margin).toEqual({ status: "set", value: "1.15in" });
    const cjk = readLatexDocumentSettings(seed("bilingual-cjk-research-note"), UNICODE);
    expect(cjk.fields.lang).toEqual({ status: "locked", reason: "class", source: "", owner: "ctexart" });
    expect(cjk.fields.margin).toEqual({ status: "set", value: "2.4cm" });
  });

  it("locks layout settings that beamer controls", () => {
    const settings = readLatexDocumentSettings(seed("research-beamer-talk"), UNICODE);
    expect(settings.lockingClass).toBe("beamer");
    expect(settings.fields.paper).toEqual({ status: "locked", reason: "class", source: "", owner: "beamer" });
    expect(settings.fields.margin).toMatchObject({ status: "locked", reason: "class" });
    expect(settings.fields.columns).toMatchObject({ status: "locked", reason: "class" });
    expect(settings.fields.fontSize).toEqual({ status: "set", value: "10pt" });
    expect(latexSettingsEdits(seed("research-beamer-talk"), { margin: "1cm", columns: "twocolumn" }, UNICODE)).toEqual([]);
  });

  it("locks venue classes and shows the values they carry", () => {
    const acm = readLatexDocumentSettings(doc("\\documentclass[sigconf,10pt]{acmart}"), UNICODE);
    expect(acm.fields.fontSize).toEqual({ status: "locked", reason: "class", source: "10pt", owner: "acmart" });
    expect(acm.fields.font).toMatchObject({ status: "locked", reason: "class" });
    expect(acm.fields.lang).toEqual({ status: "unset" });
    const ieee = readLatexDocumentSettings(doc("\\documentclass[conference]{IEEEtran}"), UNICODE);
    expect(ieee.lockingClass).toBe("IEEEtran");
    expect(ieee.fields.margin).toEqual({ status: "locked", reason: "class", source: "", owner: "IEEEtran" });
    expect(ieee.fields.columns).toEqual({ status: "unset" });
  });

  it("locks the page layout when a venue style package is loaded", () => {
    const settings = readLatexDocumentSettings(
      doc("\\documentclass{article}", "\\usepackage[final]{neurips_2024}", "\\usepackage{amsmath}"),
      UNICODE,
    );
    expect(settings.layoutStyle).toBe("neurips_2024");
    expect(settings.fields.margin).toEqual({ status: "locked", reason: "package", source: "", owner: "neurips_2024" });
    expect(settings.fields.paper).toMatchObject({ status: "locked", reason: "package" });
  });

  it("reads KOMA key-value options", () => {
    const { fields } = readLatexDocumentSettings(doc("\\documentclass[fontsize=11pt,paper=a5]{scrartcl}"), UNICODE);
    expect(fields.fontSize).toEqual({ status: "set", value: "11pt" });
    expect(fields.paper).toEqual({ status: "set", value: "a5paper" });
  });

  it("locks the main font when the compiler cannot load system fonts", () => {
    const text = doc("\\documentclass{article}", "\\usepackage{fontspec}", "\\setmainfont{Libertinus Serif}");
    expect(readLatexDocumentSettings(text, PDF).fields.font).toEqual({
      status: "locked",
      reason: "engine",
      source: "Libertinus Serif",
    });
    expect(latexSettingsEdits(text, { font: "Inter" }, PDF)).toEqual([]);
  });

  it("locks values written as macros, inside conditionals, or that it cannot parse", () => {
    const { fields } = readLatexDocumentSettings(
      doc(
        "\\documentclass{article}",
        "\\usepackage{geometry}",
        "\\geometry{margin=\\mymargin}",
        "\\ifxetex",
        "  \\usepackage{fontspec}",
        "  \\setmainfont{Inter}",
        "\\fi",
        "\\setcounter{secnumdepth}{\\value{depth}}",
      ),
      UNICODE,
    );
    expect(fields.margin).toEqual({ status: "locked", reason: "expression", source: "\\mymargin" });
    expect(fields.font).toEqual({ status: "locked", reason: "conditional", source: "Inter" });
    expect(fields.secnumdepth).toEqual({ status: "locked", reason: "expression", source: "\\value{depth}" });
  });

  it("flags preambles that pull in other files", () => {
    expect(readLatexDocumentSettings(doc("\\documentclass{article}", "\\input{preamble}"), UNICODE).externalPreamble).toBe(true);
  });

  it("reads babel main= options, polyglossia and class-level languages", () => {
    const main = readLatexDocumentSettings(doc("\\documentclass{article}", "\\usepackage[main=british,french]{babel}"), UNICODE);
    expect(main.fields.lang).toEqual({ status: "set", value: "british" });
    const last = readLatexDocumentSettings(doc("\\documentclass{article}", "\\usepackage[french,english]{babel}"), UNICODE);
    expect(last.fields.lang).toEqual({ status: "set", value: "english" });
    const poly = readLatexDocumentSettings(
      doc("\\documentclass{article}", "\\usepackage{polyglossia}", "\\setdefaultlanguage[variant=uk]{english}"),
      UNICODE,
    );
    expect(poly.fields.lang).toEqual({ status: "set", value: "english" });
    const global = readLatexDocumentSettings(doc("\\documentclass[11pt,ngerman]{article}", "\\usepackage{babel}"), UNICODE);
    expect(global.fields.lang).toEqual({ status: "set", value: "ngerman" });
  });

  it("reads \\linespread, \\setstretch and setspace options", () => {
    const spread = doc("\\documentclass{article}", "\\linespread{1.3}");
    expect(readLatexDocumentSettings(spread, UNICODE).fields.lineSpacing).toEqual({ status: "set", value: "1.3" });
    const option = doc("\\documentclass{article}", "\\usepackage[doublespacing]{setspace}");
    expect(readLatexDocumentSettings(option, UNICODE).fields.lineSpacing).toEqual({ status: "set", value: "double" });
  });
});

describe("latexSettingsEdits", () => {
  it("changes class and package options in place", () => {
    const next = edited(FULL, { fontSize: "12pt", paper: "letterpaper", margin: "1in", columns: "onecolumn" });
    expect(next.split("\n").slice(0, 2)).toEqual([
      "\\documentclass[12pt,letterpaper,onecolumn]{article}",
      "\\usepackage[margin=1in]{geometry}",
    ]);
    expect(next.split("\n").slice(2)).toEqual(FULL.split("\n").slice(2));
  });

  it("returns sorted edits that do not overlap", () => {
    const edits = latexSettingsEdits(
      doc("\\documentclass{article}", "\\usepackage{amsmath}"),
      { columns: "twocolumn", margin: "2cm", lineSpacing: "double", secnumdepth: "1", font: "Inter", lang: "french" },
      UNICODE,
    );
    for (let index = 1; index < edits.length; index++) {
      expect(edits[index].from).toBeGreaterThanOrEqual(edits[index - 1].to);
    }
  });

  it("adds class options with the list's own separator", () => {
    expect(edited(doc("\\documentclass{article}"), { columns: "twocolumn" })).toBe(doc("\\documentclass[twocolumn]{article}"));
    expect(edited(doc("\\documentclass[11pt, a4paper]{report}"), { columns: "twocolumn" })).toBe(
      doc("\\documentclass[11pt, a4paper, twocolumn]{report}"),
    );
    expect(edited(doc("\\documentclass[\n  11pt,\n  a4paper\n]{article}"), { fontSize: "12pt", columns: "twocolumn" })).toBe(
      doc("\\documentclass[\n  12pt,\n  a4paper,\n  twocolumn\n]{article}"),
    );
  });

  it("removes class options without leaving stray commas or brackets", () => {
    expect(edited(doc("\\documentclass[11pt,twocolumn]{article}"), { columns: null })).toBe(doc("\\documentclass[11pt]{article}"));
    expect(edited(doc("\\documentclass[twocolumn,11pt]{article}"), { columns: null })).toBe(doc("\\documentclass[11pt]{article}"));
    expect(edited(doc("\\documentclass[twocolumn]{article}"), { columns: null })).toBe(doc("\\documentclass{article}"));
  });

  it("writes KOMA options in their own form", () => {
    expect(edited(doc("\\documentclass[fontsize=11pt,paper=a5]{scrartcl}"), { fontSize: "12pt", paper: "letterpaper" })).toBe(
      doc("\\documentclass[fontsize=12pt,paper=letter]{scrartcl}"),
    );
  });

  it("adds geometry after the last package, or after the class when there is none", () => {
    expect(edited(doc("\\documentclass{article}", "\\usepackage{amsmath}", "", "\\title{T}"), { margin: "2cm" })).toBe(
      doc("\\documentclass{article}", "\\usepackage{amsmath}", "\\usepackage[margin=2cm]{geometry}", "", "\\title{T}"),
    );
    expect(edited(doc("\\documentclass{article}", "\\title{T}"), { margin: "2cm" })).toBe(
      doc("\\documentclass{article}", "\\usepackage[margin=2cm]{geometry}", "\\title{T}"),
    );
  });

  it("never inserts above \\documentclass and copes with a file that ends without a newline", () => {
    expect(edited(doc("\\RequirePackage{fix-cm}", "\\documentclass{article}"), { margin: "2cm" })).toBe(
      doc("\\RequirePackage{fix-cm}", "\\documentclass{article}", "\\usepackage[margin=2cm]{geometry}"),
    );
    expect(edited("\\documentclass{article}", { secnumdepth: "1" })).toBe(
      "\\documentclass{article}\n\\setcounter{secnumdepth}{1}",
    );
  });

  it("extends an existing geometry load instead of loading it twice", () => {
    expect(edited(doc("\\documentclass{article}", "\\usepackage{geometry}"), { margin: "2cm" })).toBe(
      doc("\\documentclass{article}", "\\usepackage[margin=2cm]{geometry}"),
    );
    expect(edited(doc("\\documentclass{article}", "\\usepackage[a4paper]{geometry}"), { margin: "2cm" })).toBe(
      doc("\\documentclass{article}", "\\usepackage[a4paper,margin=2cm]{geometry}"),
    );
    expect(edited(doc("\\documentclass{article}", "\\usepackage{geometry}", "\\geometry{margin=1in}"), { margin: "3cm" })).toBe(
      doc("\\documentclass{article}", "\\usepackage{geometry}", "\\geometry{margin=3cm}"),
    );
    expect(edited(doc("\\documentclass{article}", "\\RequirePackage[margin=1in]{geometry}"), { margin: "3cm" })).toBe(
      doc("\\documentclass{article}", "\\RequirePackage[margin=3cm]{geometry}"),
    );
  });

  it("uses a separate \\geometry call when the preamble loads other files", () => {
    expect(edited(doc("\\documentclass{article}", "\\input{preamble}", "\\usepackage{amsmath}"), { margin: "2cm" })).toBe(
      doc("\\documentclass{article}", "\\input{preamble}", "\\usepackage{amsmath}", "\\usepackage{geometry}", "\\geometry{margin=2cm}"),
    );
  });

  it("removes a margin and the geometry line it was the only option of", () => {
    expect(edited(doc("\\documentclass{article}", "\\usepackage[margin=2cm]{geometry}", "\\usepackage{amsmath}"), { margin: null })).toBe(
      doc("\\documentclass{article}", "\\usepackage{amsmath}"),
    );
    expect(edited(doc("\\documentclass{article}", "\\usepackage[a4paper, margin=2cm]{geometry}"), { margin: null })).toBe(
      doc("\\documentclass{article}", "\\usepackage[a4paper]{geometry}"),
    );
  });

  it("never edits per-side margins it cannot express", () => {
    expect(latexSettingsEdits(seed("ieee-two-column-journal-article"), { margin: "1in" }, UNICODE)).toEqual([]);
  });

  it("adds fontspec once and sets the main font", () => {
    expect(edited(doc("\\documentclass{article}", "\\usepackage{amsmath}"), { font: "Libertinus Serif" })).toBe(
      doc("\\documentclass{article}", "\\usepackage{amsmath}", "\\usepackage{fontspec}", "\\setmainfont{Libertinus Serif}"),
    );
    expect(
      edited(doc("\\documentclass{article}", "\\usepackage{fontspec}", "\\setmainfont[Ligatures=TeX]{Old}"), { font: "New" }),
    ).toBe(doc("\\documentclass{article}", "\\usepackage{fontspec}", "\\setmainfont[Ligatures=TeX]{New}"));
    expect(edited(doc("\\documentclass{article}", "\\usepackage{fontspec}", "\\setmainfont{Old}"), { font: null })).toBe(
      doc("\\documentclass{article}", "\\usepackage{fontspec}"),
    );
  });

  it("sets the language through babel or polyglossia", () => {
    expect(edited(doc("\\documentclass{article}", "\\usepackage[english]{babel}"), { lang: "ngerman" })).toBe(
      doc("\\documentclass{article}", "\\usepackage[ngerman]{babel}"),
    );
    expect(edited(doc("\\documentclass{article}", "\\usepackage[main = british,french]{babel}"), { lang: "english" })).toBe(
      doc("\\documentclass{article}", "\\usepackage[main = english,french]{babel}"),
    );
    expect(edited(doc("\\documentclass{article}", "\\usepackage{polyglossia}", "\\setdefaultlanguage{english}"), { lang: "french" })).toBe(
      doc("\\documentclass{article}", "\\usepackage{polyglossia}", "\\setdefaultlanguage{french}"),
    );
    expect(edited(doc("\\documentclass{article}", "\\usepackage{polyglossia}"), { lang: "french" })).toBe(
      doc("\\documentclass{article}", "\\usepackage{polyglossia}", "\\setdefaultlanguage{french}"),
    );
    expect(edited(doc("\\documentclass{article}"), { lang: "french" })).toBe(
      doc("\\documentclass{article}", "\\usepackage[french]{babel}"),
    );
    expect(edited(doc("\\documentclass[ngerman]{article}", "\\usepackage{babel}"), { lang: "french" })).toBe(
      doc("\\documentclass[french]{article}", "\\usepackage{babel}"),
    );
    expect(edited(doc("\\documentclass{article}", "\\usepackage[english]{babel}", "\\usepackage{amsmath}"), { lang: null })).toBe(
      doc("\\documentclass{article}", "\\usepackage{amsmath}"),
    );
  });

  it("sets line spacing through setspace", () => {
    expect(edited(doc("\\documentclass{article}", "\\usepackage{amsmath}"), { lineSpacing: "onehalf" })).toBe(
      doc("\\documentclass{article}", "\\usepackage{amsmath}", "\\usepackage{setspace}", "\\onehalfspacing"),
    );
    expect(edited(seed("computational-physics-phd-thesis"), { lineSpacing: "double" })).toBe(
      seed("computational-physics-phd-thesis").replace("\\onehalfspacing", "\\doublespacing"),
    );
    expect(edited(doc("\\documentclass{article}", "\\usepackage[doublespacing]{setspace}"), { lineSpacing: "onehalf" })).toBe(
      doc("\\documentclass{article}", "\\usepackage[onehalfspacing]{setspace}"),
    );
    expect(edited(doc("\\documentclass{article}", "\\linespread{1.3}"), { lineSpacing: "1.5" })).toBe(
      doc("\\documentclass{article}", "\\linespread{1.5}"),
    );
    expect(edited(doc("\\documentclass{article}", "\\usepackage{amsmath}", "\\linespread{1.3}"), { lineSpacing: "double" })).toBe(
      doc("\\documentclass{article}", "\\usepackage{amsmath}", "\\usepackage{setspace}", "\\doublespacing"),
    );
    expect(edited(doc("\\documentclass{article}", "\\usepackage{setspace}", "\\doublespacing"), { lineSpacing: null })).toBe(
      doc("\\documentclass{article}", "\\usepackage{setspace}"),
    );
  });

  it("relies on memoir's built-in setspace commands", () => {
    expect(edited(doc("\\documentclass[12pt]{memoir}"), { lineSpacing: "onehalf" })).toBe(
      doc("\\documentclass[12pt]{memoir}", "\\onehalfspacing"),
    );
  });

  it("sets the numbering depth and equation numbering", () => {
    expect(edited(doc("\\documentclass{article}", "\\usepackage{amsmath}"), { secnumdepth: "1", equationNumbering: "section" })).toBe(
      doc(
        "\\documentclass{article}",
        "\\usepackage{amsmath}",
        "\\setcounter{secnumdepth}{1}",
        "\\numberwithin{equation}{section}",
      ),
    );
    expect(edited(doc("\\documentclass{report}"), { equationNumbering: "chapter" })).toBe(
      doc("\\documentclass{report}", "\\usepackage{amsmath}", "\\numberwithin{equation}{chapter}"),
    );
    expect(edited(FULL, { secnumdepth: "3", equationNumbering: null })).toBe(
      FULL.replace("\\setcounter{secnumdepth}{2}", "\\setcounter{secnumdepth}{3}").replace("\\numberwithin{equation}{section}\n", ""),
    );
  });

  it("puts new packages before new commands", () => {
    expect(
      edited(doc("\\documentclass{article}", "\\usepackage{amsmath}", "\\title{T}"), {
        margin: "2cm",
        font: "Inter",
        lineSpacing: "double",
        secnumdepth: "2",
      }),
    ).toBe(
      doc(
        "\\documentclass{article}",
        "\\usepackage{amsmath}",
        "\\usepackage[margin=2cm]{geometry}",
        "\\usepackage{fontspec}",
        "\\usepackage{setspace}",
        "\\setmainfont{Inter}",
        "\\doublespacing",
        "\\setcounter{secnumdepth}{2}",
        "\\title{T}",
      ),
    );
  });

  it("skips invalid values", () => {
    expect(latexSettingsEdits(FULL, { margin: "wide", fontSize: "big" }, UNICODE)).toEqual([]);
  });
});

describe("validateLatexSetting", () => {
  it("accepts LaTeX values and rejects the rest", () => {
    expect(validateLatexSetting("margin", "2.5cm")).toBe(true);
    expect(validateLatexSetting("margin", "1in")).toBe(true);
    expect(validateLatexSetting("margin", "wide")).toBe(false);
    expect(validateLatexSetting("fontSize", "11pt")).toBe(true);
    expect(validateLatexSetting("fontSize", "11")).toBe(false);
    expect(validateLatexSetting("font", "TeX Gyre Termes")).toBe(true);
    expect(validateLatexSetting("font", "\\bad")).toBe(false);
    expect(validateLatexSetting("lang", "ngerman")).toBe(true);
    expect(validateLatexSetting("lang", "en_US")).toBe(false);
    expect(validateLatexSetting("lineSpacing", "onehalf")).toBe(true);
    expect(validateLatexSetting("lineSpacing", "1.25")).toBe(true);
    expect(validateLatexSetting("secnumdepth", "-1")).toBe(true);
    expect(validateLatexSetting("equationNumbering", "section")).toBe(true);
    expect(validateLatexSetting("paper", "a4paper")).toBe(true);
    expect(validateLatexSetting("paper", "a4")).toBe(false);
  });
});

describe("latexSupportsSystemFonts", () => {
  it("follows the project's compiler", () => {
    expect(latexSupportsSystemFonts("latex", undefined, "")).toBe(true);
    expect(latexSupportsSystemFonts("latexmk", "xelatex", "")).toBe(true);
    expect(latexSupportsSystemFonts("latexmk", "lualatex", "")).toBe(true);
    expect(latexSupportsSystemFonts("latexmk", "pdflatex", "\\usepackage{fontspec}")).toBe(false);
    expect(latexSupportsSystemFonts("latexmk", undefined, "% !TeX program = lualatex\n\\documentclass{article}")).toBe(true);
    expect(latexSupportsSystemFonts("latexmk", undefined, "% !TeX program = pdflatex\n\\usepackage{fontspec}")).toBe(false);
    expect(latexSupportsSystemFonts("latexmk", undefined, "\\documentclass{article}")).toBe(false);
    expect(latexSupportsSystemFonts("latexmk", undefined, "\\usepackage{fontspec}")).toBe(true);
  });
});
