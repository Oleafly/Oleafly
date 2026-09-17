import { describe, expect, it } from "vitest";
import {
  findEnvironment,
  readBalanced,
  scanMacroArguments,
  splitEnvironmentSource,
  splitTopLevel,
  stripLatexComments,
} from "./arguments";

describe("readBalanced", () => {
  it("returns the index after the matching closer with nested braces", () => {
    expect(readBalanced("{a{b}c}d", 0, "{", "}")).toBe(7);
  });

  it("ignores escaped braces", () => {
    expect(readBalanced(String.raw`{a\}b}`, 0, "{", "}")).toBe(6);
  });

  it("keeps brackets inside braces from closing an optional argument", () => {
    expect(readBalanced("[a{]}b]", 0, "[", "]")).toBe(7);
  });

  it("returns null when the start is not the opener or the group never closes", () => {
    expect(readBalanced("abc", 0, "{", "}")).toBeNull();
    expect(readBalanced("{abc", 0, "{", "}")).toBeNull();
    expect(readBalanced("{a}b}", 0, "}", "{")).toBeNull();
  });
});

describe("scanMacroArguments", () => {
  it("reads a star, optional and mandatory arguments with exact content", () => {
    const source = String.raw`\section*[Short]{Long \textbf{x}} tail`;
    const scanned = scanMacroArguments(source, "\\section".length);
    expect(scanned.starred).toBe(true);
    expect(scanned.args).toEqual([
      { kind: "optional", value: "Short" },
      { kind: "mandatory", value: String.raw`Long \textbf{x}` },
    ]);
    expect(source.slice(scanned.end)).toBe(" tail");
  });

  it("stops at the first token that is not an argument", () => {
    const scanned = scanMacroArguments(String.raw`\centering \includegraphics{x}`, "\\centering".length);
    expect(scanned.starred).toBe(false);
    expect(scanned.args).toEqual([]);
    expect(scanned.end).toBe("\\centering".length);
  });

  it("stops at an unbalanced argument", () => {
    expect(scanMacroArguments("\\foo{unclosed", 4).args).toEqual([]);
  });

  it("skips whitespace between arguments", () => {
    const scanned = scanMacroArguments("\\foo [a]\n{b}", 4);
    expect(scanned.args.map((arg) => arg.value)).toEqual(["a", "b"]);
  });
});

describe("splitEnvironmentSource", () => {
  it("splits the name, optional argument and body", () => {
    expect(splitEnvironmentSource("\\begin{theorem}[Euler's identity]\nBody\n\\end{theorem}")).toEqual({
      name: "theorem",
      optional: "Euler's identity",
      body: "\nBody\n",
    });
  });

  it("returns a null optional argument when none follows the opener", () => {
    expect(splitEnvironmentSource("\\begin{proof}\nx\n\\end{proof}")).toEqual({
      name: "proof",
      optional: null,
      body: "\nx\n",
    });
  });

  it("keeps an unclosed bracket as body text", () => {
    expect(splitEnvironmentSource("\\begin{proof}[x\n\\end{proof}")?.body).toBe("[x\n");
  });

  it("rejects sources that are not a single environment", () => {
    expect(splitEnvironmentSource("\\section{x}")).toBeNull();
    expect(splitEnvironmentSource("\\begin{a}x\\end{b}")).toBeNull();
  });
});

describe("stripLatexComments", () => {
  it("drops comments but keeps escaped percent signs", () => {
    expect(stripLatexComments("a \\% b % comment\nc")).toBe("a \\% b \nc");
  });

  it("drops a trailing comment without a newline", () => {
    expect(stripLatexComments("a % tail")).toBe("a ");
  });
});

describe("splitTopLevel", () => {
  it("splits on the separator outside braces only", () => {
    expect(splitTopLevel("a & \\textbf{b & c} & d", "&")).toEqual(["a ", " \\textbf{b & c} ", " d"]);
  });

  it("splits on double backslashes while ignoring escaped ampersands", () => {
    expect(splitTopLevel("a \\& b \\\\ c", "\\\\")).toEqual(["a \\& b ", " c"]);
  });

  it("returns the whole string when the separator is absent", () => {
    expect(splitTopLevel("plain", "&")).toEqual(["plain"]);
  });
});

describe("findEnvironment", () => {
  it("finds the outermost environment of the given name", () => {
    const source = "x \\begin{tabular}{c} \\begin{tabular}{c} y \\end{tabular} \\end{tabular} z";
    const found = findEnvironment(source, "tabular");
    expect(found?.start).toBe(2);
    expect(source.slice(found?.start, found?.end)).toBe(
      "\\begin{tabular}{c} \\begin{tabular}{c} y \\end{tabular} \\end{tabular}",
    );
    expect(found?.inner).toBe("{c} \\begin{tabular}{c} y \\end{tabular} ");
  });

  it("returns null when the environment is missing or unclosed", () => {
    expect(findEnvironment("plain", "tabular")).toBeNull();
    expect(findEnvironment("\\begin{tabular}{c} x", "tabular")).toBeNull();
  });
});
