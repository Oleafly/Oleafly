import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseLatexLog } from "./latex-log";
import { MAX_COMPILE_LOG_BYTES } from "./types";

const GOLDEN_DIR = fileURLToPath(
  new URL("../../../../crates/oleafly-core/tests/fixtures/compile-log/", import.meta.url),
);

function golden(name: string) {
  const expected = JSON.parse(readFileSync(`${GOLDEN_DIR}${name}.expected.json`, "utf8")) as {
    rootFile: string | null;
    diagnostics: unknown[];
  };
  const log = readFileSync(`${GOLDEN_DIR}${name}.log`, "utf8");
  return { expected, actual: parseLatexLog(log, expected.rootFile ?? undefined) };
}

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

  it("surfaces Oleafly Biber mode diagnostics and biblatex rerun warnings", () => {
    const log = [
      "Package biblatex Warning: Please (re)run Biber on the file:",
      "(biblatex)                _oleafly_entry",
      "(biblatex)                and rerun LaTeX afterwards.",
      "[Oleafly] Bibliography needs Biber (biblatex), but a usable .bbl was not produced.",
      "[Oleafly] Biber was not found (mode A): GUI launches often have a minimal PATH",
    ].join("\n");
    const diags = parseLatexLog(log);
    expect(diags.some((d) => d.category === "biber" && d.message.includes("Bibliography needs Biber"))).toBe(
      true,
    );
    expect(diags.some((d) => d.category === "biber" && d.severity === "error" && d.message.includes("mode A"))).toBe(
      true,
    );
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

  it("matches the golden logs shared with the Rust parser", () => {
    const names = readdirSync(GOLDEN_DIR)
      .filter((name) => name.endsWith(".log"))
      .map((name) => name.slice(0, -".log".length));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const { expected, actual } = golden(name);
      expect(actual, name).toEqual(expected.diagnostics);
    }
  });

  it("attributes errors in Tectonic's extensionless \\input{kapitoly/úvod} to the child file", () => {
    const errors = golden("tectonic-extensionless-input").actual.filter((d) => d.severity === "error");
    expect(errors.map((d) => [d.file, d.line])).toEqual([
      ["./kapitoly/úvod", 2],
      ["./kapitoly/úvod", 2],
    ]);
  });

  it("does not treat dates or words in parentheses as input files", () => {
    const log = [
      "(./main.tex",
      "Package: foo 2021/01/01 (v1.0)",
      "(2021/01/01) (Font) (see chapters/intro)",
      "(chapters/intro",
      "! Undefined control sequence.",
      "l.3 \\bad",
      "",
      ")",
      "! Undefined control sequence.",
      "l.9 \\bad",
      "",
      "(01-uvod/text (2021-01/01)",
      "! Undefined control sequence.",
      "l.4 \\bad",
      "",
      ")",
    ].join("\n");
    expect(parseLatexLog(log).map((d) => [d.file, d.line])).toEqual([
      ["./chapters/intro", 3],
      ["./main.tex", 9],
      ["./01-uvod/text", 4],
    ]);
  });

  it("keeps the \\input file that pdfTeX opens right after a Font Info block", () => {
    const diagnostics = golden("pdflatex-input-after-font-info").actual.filter(
      (d) => d.severity !== "info",
    );
    expect(diagnostics.map((d) => [d.category, d.file, d.line])).toEqual([
      ["undefined-reference", "./ch/one.tex", 1],
      ["overfull-box", "./ch/one.tex", 2],
    ]);
  });

  it("starts a new diagnostic for an error that follows an info line directly", () => {
    const log = [
      "(./main.tex",
      "LaTeX Font Info:    ... okay on input line 3.",
      "! Undefined control sequence.",
      "l.4 \\bad",
      "",
      ")",
    ].join("\n");
    const errors = parseLatexLog(log).filter((d) => d.severity === "error");
    expect(errors.map((d) => [d.file, d.line, d.message])).toEqual([
      ["./main.tex", 4, "Undefined control sequence."],
    ]);
  });

  it("recovers undefined references hard-wrapped at 79 columns", () => {
    const refs = golden("tectonic-wrapped-references").actual.filter(
      (d) => d.category === "undefined-reference",
    );
    expect(refs.map((d) => d.line)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(refs[4].message).toBe("Cannot find reference `fig:experimental-setup`.");
    expect(refs[5].message).toBe("Cannot find reference `图表实验设置`.");
  });

  it("reads the line number of a wrapped citation and of a wrapped package warning", () => {
    const log = [
      "LaTeX Warning: Citation `knuth:the-art-of-computer-programming' on page 1 undefi",
      "ned on input line 12.",
      "",
      "Package natbib Warning: Citation `a-very-long-key-for-natbib-citations' undefined",
      " on input line 14.",
      "",
    ].join("\n");
    expect(parseLatexLog(log).map((d) => [d.category, d.line, d.message])).toEqual([
      ["undefined-citation", 12, "Cannot find citation `knuth:the-art-of-computer-programming`."],
      [
        "package-warning",
        14,
        "Package natbib: Citation `a-very-long-key-for-natbib-citations' undefined\n on input line 14.",
      ],
    ]);
  });

  it("reads the l.<n> line of '! LaTeX Error:' through its help block", () => {
    const log = [
      "(./main.tex",
      "! LaTeX Error: \\begin{itemize} on input line 2 ended by \\end{enumerate}.",
      "",
      "See the LaTeX manual or LaTeX Companion for explanation.",
      "Type  H <return>  for immediate help.",
      " ...                                              ",
      "                                                  ",
      "l.4 \\end{enumerate}",
      "                   ",
      "Your command was ignored.",
      "",
      "! Package babel Error: Unknown option `xyz'.",
      "",
      "See the babel package documentation for explanation.",
      "Type  H <return>  for immediate help.",
      " ...                                              ",
      "                                                  ",
      "l.7 \\begin{document}",
      "",
      ")",
    ].join("\n");
    expect(parseLatexLog(log).map((d) => [d.file, d.line, d.message, d.errorContext])).toEqual([
      [
        "./main.tex",
        4,
        "\\begin{itemize} on input line 2 ended by \\end{enumerate}.",
        "! LaTeX Error: \\begin{itemize} on input line 2 ended by \\end{enumerate}.\nl.4 \\end{enumerate}",
      ],
      [
        "./main.tex",
        7,
        "Package babel: Unknown option `xyz'.",
        "! Package babel Error: Unknown option `xyz'.\nl.7 \\begin{document}",
      ],
    ]);
  });

  it("stops waiting for an error's l.<n> line at the next ordinary log line", () => {
    const log = [
      "! Emergency stop.",
      "<*> main.tex",
      "",
      "*** (job aborted, no legal \\end found)",
      "",
      "LaTeX Warning: Reference `x' on page 1 undefined on input line 5.",
    ].join("\n");
    expect(parseLatexLog(log).map((d) => [d.category, d.line])).toEqual([
      ["error", null],
      ["undefined-reference", 5],
    ]);
  });

  it("ignores the engine output appended after a failed Tectonic compile", () => {
    const diagnostics = golden("tectonic-engine-output-tail").actual;
    expect(diagnostics.every((d) => !d.file?.startsWith("error: "))).toBe(true);
    expect(
      diagnostics.filter((d) => d.severity === "error").map((d) => [d.file, d.line, d.message]),
    ).toEqual([
      ["./kapitoly/úvod", 1, "Undefined control sequence."],
      ["./kapitoly/úvod", 4, "\\begin{itemize} on input line 2 ended by \\end{enumerate}."],
    ]);
  });

  it("skips Tectonic's error summary lines and keeps parsing Oleafly notes after the engine output", () => {
    const log = [
      "error: main.tex:6: Unable to load picture or PDF file 'figures/empty.png'",
      "[Oleafly] Engine output:",
      "! Undefined control sequence.",
      "l.2 \\bad",
      "",
      "[Oleafly] Bibliography needs Biber (biblatex), but a usable .bbl was not produced.",
    ].join("\n");
    expect(parseLatexLog(log).map((d) => [d.category, d.message])).toEqual([
      ["biber", "Bibliography needs Biber (biblatex), but a usable .bbl was not produced."],
    ]);
  });
});
