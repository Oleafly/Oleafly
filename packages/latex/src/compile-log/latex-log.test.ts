import { describe, expect, it } from "vitest";
import { parseLatexLog } from "./latex-log";
import { MAX_COMPILE_LOG_BYTES } from "./types";

describe("parseLatexLog", () => {
  it("parses a bang-style error with its l.<n> context excerpt", () => {
    const log = [
      "! Undefined control sequence.",
      "l.33 \\badmacro",
      "               ",
      "? ",
    ].join("\n");

    const diags = parseLatexLog(log);
    expect(diags).toHaveLength(1);
    const d = diags[0];
    expect(d.severity).toBe("error");
    expect(d.category).toBe("error");
    expect(d.message).toBe("Undefined control sequence.");
    expect(d.file).toBeNull();
    // Port addition over upstream becabe2: the `l.33` excerpt supplies the
    // line for bang-form errors so error cards can navigate.
    expect(d.line).toBe(33);
    expect(d.errorContext).toBe("! Undefined control sequence.\nl.33 \\badmacro");
  });

  it("attributes file and line for file:line:error-style errors", () => {
    const log = [
      "./main.tex:12: Undefined control sequence.",
      "l.12 \\badmacro",
      "",
    ].join("\n");

    const diags = parseLatexLog(log);
    expect(diags).toHaveLength(1);
    const d = diags[0];
    expect(d.severity).toBe("error");
    expect(d.category).toBe("error");
    expect(d.message).toBe("Undefined control sequence.");
    expect(d.file).toBe("./main.tex");
    expect(d.line).toBe(12);
    expect(d.errorContext).toBe(
      "./main.tex:12: Undefined control sequence.\nl.12 \\badmacro"
    );
  });

  it("attributes diagnostics to the innermost file on the ( ... ) stack", () => {
    const log = [
      "(./main.tex [1] first page",
      "(./chapters/ch1.tex",
      "LaTeX Warning: Reference `fig:one' on page 1 undefined on input line 5.",
      ") back in the root file",
      "LaTeX Warning: Reference `fig:two' on page 2 undefined on input line 40.",
      ")",
    ].join("\n");

    const diags = parseLatexLog(log);
    expect(diags).toHaveLength(2);
    expect(diags[0].file).toBe("./chapters/ch1.tex");
    expect(diags[0].line).toBe(5);
    expect(diags[1].file).toBe("./main.tex");
    expect(diags[1].line).toBe(40);
  });

  it("parses undefined reference and citation warnings", () => {
    const log = [
      "LaTeX Warning: Reference `fig:x' on page 1 undefined on input line 10.",
      "LaTeX Warning: Citation `knuth1984' on page 2 undefined on input line 12.",
      "LaTeX Warning: There were undefined references.",
    ].join("\n");

    const diags = parseLatexLog(log);
    // The "There were undefined references." summary line is swallowed.
    expect(diags).toHaveLength(2);

    expect(diags[0].severity).toBe("warning");
    expect(diags[0].category).toBe("undefined-reference");
    expect(diags[0].line).toBe(10);
    expect(diags[0].message).toBe("Cannot find reference `fig:x`.");

    expect(diags[1].severity).toBe("warning");
    expect(diags[1].category).toBe("undefined-citation");
    expect(diags[1].line).toBe(12);
    expect(diags[1].message).toBe("Cannot find citation `knuth1984`.");
  });

  it("parses overfull and underfull box warnings as typesetting diagnostics", () => {
    const log = [
      "Overfull \\hbox (15.36pt too wide) in paragraph at lines 21--22",
      "[]\\OT1/cmr/m/n/10 This line sticks out into the margin",
      "",
      "Underfull \\vbox (badness 10000) detected at line 19",
      " []",
      "",
    ].join("\n");

    const diags = parseLatexLog(log);
    expect(diags).toHaveLength(2);

    expect(diags[0].severity).toBe("typesetting");
    expect(diags[0].category).toBe("overfull-box");
    expect(diags[0].line).toBe(21);
    expect(diags[0].message).toBe("Overfull \\hbox (15.36pt too wide)");

    expect(diags[1].severity).toBe("typesetting");
    expect(diags[1].category).toBe("underfull-box");
    expect(diags[1].line).toBe(19);
    expect(diags[1].message).toBe("Underfull \\vbox (badness 10000)");
  });

  it("merges package warning continuation lines and picks up the input line", () => {
    const log = [
      "Package hyperref Warning: Token not allowed in a PDF string (Unicode):",
      "(hyperref)                removing `math shift' on input line 42.",
      "",
    ].join("\n");

    const diags = parseLatexLog(log);
    expect(diags).toHaveLength(1);
    const d = diags[0];
    expect(d.severity).toBe("warning");
    expect(d.category).toBe("package-warning");
    expect(d.line).toBe(42);
    expect(d.message).toBe(
      "Package hyperref: Token not allowed in a PDF string (Unicode):\n(hyperref)\tremoving `math shift'."
    );
  });

  it("parses missing character warnings", () => {
    const log = [
      "Missing character: There is no ő in font nullfont!",
      "",
    ].join("\n");

    const diags = parseLatexLog(log);
    expect(diags).toHaveLength(1);
    const d = diags[0];
    expect(d.severity).toBe("warning");
    expect(d.category).toBe("missing-character");
    expect(d.message).toBe("Missing character: There is no ő in font nullfont!");
    expect(d.line).toBeNull();
  });

  it("accumulates multi-line error text until the l.<n> excerpt", () => {
    const log = [
      "! Package amsmath Error: \\begin{split} won't work here.",
      "Try typing  <return>  to proceed.",
      "If that doesn't work, type  X <return>  to quit.",
      "l.5 \\begin{split}",
      "",
    ].join("\n");

    const diags = parseLatexLog(log);
    expect(diags).toHaveLength(1);
    const d = diags[0];
    expect(d.severity).toBe("error");
    expect(d.message).toBe(
      "Package amsmath: \\begin{split} won't work here.\n" +
        "Try typing  <return>  to proceed.\n" +
        "If that doesn't work, type  X <return>  to quit."
    );
    expect(d.errorContext).toBe(
      "! Package amsmath Error: \\begin{split} won't work here.\n" +
        "Try typing  <return>  to proceed.\n" +
        "If that doesn't work, type  X <return>  to quit.\n" +
        "l.5 \\begin{split}"
    );
  });

  it("drops the redundant 'LaTeX' prefix from '! LaTeX Error:' messages", () => {
    const log = [
      "! LaTeX Error: Environment itemize undefined.",
      "",
      "See the LaTeX manual or LaTeX Companion for explanation.",
    ].join("\n");

    const diags = parseLatexLog(log);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe("Environment itemize undefined.");
    expect(diags[0].errorContext).toBe("! LaTeX Error: Environment itemize undefined.");
  });

  it("returns [] for empty and garbage input without throwing", () => {
    expect(parseLatexLog("")).toEqual([]);

    const garbage = [
      "This is pdfTeX, Version 3.141592653-2.6-1.7.11 (TeX Live 2024) (preloaded format=pdflatex)",
      " restricted \\write18 enabled.",
      "entering extended mode",
      "**main.tex",
      "\u0000\u0001 binary junk \u0002",
    ].join("\n");
    expect(parseLatexLog(garbage)).toEqual([]);
  });

  it("only parses the first MAX_COMPILE_LOG_BYTES of the log", () => {
    // Exactly MAX_COMPILE_LOG_BYTES of filler, so the error after it is
    // sliced off before parsing.
    const filler = `${"x".repeat(1023)}\n`.repeat(MAX_COMPILE_LOG_BYTES / 1024);
    const log = `${filler}! Undefined control sequence.\nl.3 \\bad\n`;

    let diags: ReturnType<typeof parseLatexLog> = [];
    expect(() => {
      diags = parseLatexLog(log);
    }).not.toThrow();
    expect(diags).toEqual([]);
  });

  it("attributes diagnostics before any '(' to the rootFile parameter", () => {
    const warning =
      "LaTeX Warning: Reference `fig:x' on page 1 undefined on input line 10.";
    const diags = parseLatexLog(warning, "/proj/main.tex");
    expect(diags).toHaveLength(1);
    expect(diags[0].file).toBe("/proj/main.tex");

    const error = ["! Undefined control sequence.", "l.3 \\bad", ""].join("\n");
    const errDiags = parseLatexLog(error, "/proj/main.tex");
    expect(errDiags).toHaveLength(1);
    expect(errDiags[0].file).toBe("/proj/main.tex");
  });
});
