import { describe, expect, it } from "vitest";
import { parseBody } from "./body";
import { parseSnippetFile, serializeSnippetFile } from "./file";
import type { SnippetProblem, SnippetRecord } from "./types";

const VS_CODE_FILE = `// Place your snippets for LaTeX here. Each snippet is defined under a snippet name and has a prefix, body and
// description. The prefix is what is used to trigger the snippet and the body will be expanded and inserted.
/*
 * Example:
 */
{
\t"Theorem": {
\t\t"prefix": ["thm", "theorem", "thm"],
\t\t"body": ["\\\\begin{theorem}", "\\t$0", "\\\\end{theorem}"],
\t\t"description": "Theorem environment",
\t\t"scope": "latex,tex",
\t},
}
`;

function only(text: string, layer: SnippetRecord["layer"] = "user"): SnippetRecord {
  const file = parseSnippetFile(text, "mine", layer);
  expect(file.problems).toEqual([]);
  expect(file.records).toHaveLength(1);
  return file.records[0];
}

function problemsOf(text: string, layer: SnippetRecord["layer"] = "user"): SnippetProblem[] {
  return parseSnippetFile(text, "mine", layer).problems;
}

describe("parseSnippetFile", () => {
  it("loads a VS Code file with comments and trailing commas", () => {
    const record = only(VS_CODE_FILE);
    expect(record).toMatchObject({
      id: "Theorem",
      name: "Theorem",
      description: "Theorem environment",
      trigger: "thm",
      aliases: ["theorem"],
      regex: null,
      expand: "tab",
      languages: ["latex"],
      place: "any",
      inWord: false,
      lineStart: false,
      priority: 0,
      wraps: false,
      collection: "mine",
      layer: "user",
    });
    expect(record.bodies).toEqual({ default: parseBody("\\begin{theorem}\n\t$0\n\\end{theorem}").nodes });
  });

  it("reads the Oleafly keys", () => {
    const record = only(
      JSON.stringify({
        frac: {
          name: "Fraction",
          nameKey: "latex.snippet.frac",
          prefix: "//",
          body: "\\frac{$1}{$2}$0",
          expand: "auto",
          where: "math",
          languages: ["latex", "typst"],
          inWord: true,
          lineStart: true,
          priority: 2,
          typstSince: [0, 13],
        },
      }),
    );
    expect(record).toMatchObject({
      id: "frac",
      name: "Fraction",
      nameKey: "latex.snippet.frac",
      trigger: "//",
      expand: "auto",
      place: "math",
      languages: ["latex", "typst"],
      inWord: true,
      lineStart: true,
      priority: 2,
      typstSince: [0, 13],
    });
  });

  it("reads a body per language and takes the languages from it", () => {
    const record = only(
      JSON.stringify({ thm: { prefix: "thm", body: { latex: ["\\begin{theorem}", "$0"], typst: "#theorem[$0]" } } }),
    );
    expect(Object.keys(record.bodies)).toEqual(["latex", "typst"]);
    expect(record.languages).toEqual(["latex", "typst"]);
  });

  it("keeps any language when a default body is present or nothing says otherwise", () => {
    expect(only(JSON.stringify({ a: { prefix: "a", body: { default: "x", latex: "y" } } })).languages).toBe("any");
    expect(only(JSON.stringify({ a: { prefix: "a", body: "x" } })).languages).toBe("any");
    expect(only(JSON.stringify({ a: { prefix: "a", body: "x", languages: "any" } })).languages).toBe("any");
  });

  it.each([
    ["typst", ["typst"]],
    ["markdown, bibtex", ["markdown", "bibtex"]],
    ["plaintext", ["notes"]],
    ["javascript,latex", ["latex"]],
  ])("maps the VS Code scope %s", (scope, languages) => {
    expect(only(JSON.stringify({ a: { prefix: "a", body: "x", scope } })).languages).toEqual(languages);
  });

  it("warns when a scope names no language Oleafly edits", () => {
    const file = parseSnippetFile(JSON.stringify({ log: { prefix: "log", body: "console.log($1)", scope: "javascript" } }), "js", "user");
    expect(file.records[0].languages).toEqual([]);
    expect(file.problems).toEqual([
      expect.objectContaining({ id: "log", code: "no-language", severity: "warning", line: 1 }),
    ]);
  });

  it("compiles a regex trigger anchored at the end", () => {
    const record = only(JSON.stringify({ sub: { prefix: "re:([A-Za-z])(\\d)", body: "[[0]]_[[1]]", expand: "auto" } }), "pack");
    expect(record.trigger).toBe("([A-Za-z])(\\d)");
    expect(record.regex?.flags).toBe("u");
    expect(record.regex?.exec("$x1")?.slice(1)).toEqual(["x", "1"]);
    expect(record.regex?.test("x1 ")).toBe(false);
  });

  it("reads the regex key and lets it switch a re: prefix off", () => {
    expect(only(JSON.stringify({ a: { prefix: "a+b", regex: true, body: "x" } })).regex?.source).toBe("(?:a+b)$");
    const literal = only(JSON.stringify({ a: { prefix: "re:x", regex: false, body: "x" } }));
    expect([literal.trigger, literal.regex]).toEqual(["re:x", null]);
  });

  it("has no trigger without a prefix or with an empty one", () => {
    expect(only(JSON.stringify({ a: { body: "x" } })).trigger).toBeNull();
    expect(only(JSON.stringify({ a: { prefix: "", body: "x" } })).trigger).toBeNull();
    expect(only(JSON.stringify({ a: { prefix: ["", "b"], body: "x" } })).trigger).toBe("b");
  });

  it("marks a body that uses the selection as a wrapper", () => {
    expect(only(JSON.stringify({ em: { prefix: "em", body: "\\emph{${TM_SELECTED_TEXT}}" } })).wraps).toBe(true);
  });

  it("reads the pack header", () => {
    const file = parseSnippetFile(
      JSON.stringify({ $pack: { name: "At", nameKey: "snippets.packs.at", source: "https://x", licence: "MIT" }, a: { prefix: "a", body: "x" } }),
      "at",
      "builtin",
    );
    expect(file.header).toEqual({ name: "At", nameKey: "snippets.packs.at", source: "https://x", licence: "MIT" });
    expect(file.records.map((record) => record.id)).toEqual(["a"]);
    expect(parseSnippetFile("{}", "x", "user")).toEqual({ collection: "x", records: [], problems: [] });
  });

  it.each([[{ $pack: "x" }], [{ $pack: { name: 3 } }]])("ignores a bad header with a warning", (json) => {
    const file = parseSnippetFile(JSON.stringify(json), "x", "pack");
    expect(file.header).toBeUndefined();
    expect(file.problems).toEqual([expect.objectContaining({ code: "header", severity: "warning", line: 1 })]);
  });

  it("keeps no records and reports one error on the right line for broken JSON", () => {
    const text = '{\n  "a": { "prefix": "a", "body": "x" },\n  "b": { "prefix": "b" "body": "y" }\n}';
    expect(parseSnippetFile(text, "mine", "user")).toEqual({
      collection: "mine",
      records: [],
      problems: [
        {
          collection: "mine",
          line: 3,
          code: "json",
          message: "Not valid JSON. Expected a comma or a closing brace",
          severity: "error",
        },
      ],
    });
  });

  it("reports a file that is not an object", () => {
    expect(problemsOf("[1, 2]")).toEqual([expect.objectContaining({ code: "not-object", line: 1, severity: "error" })]);
  });

  it("skips an unknown expand with a problem naming the id and line", () => {
    const text = '{\n  "good": { "prefix": "g", "body": "x" },\n  "odd": { "prefix": "o", "body": "y", "expand": "always" }\n}';
    const file = parseSnippetFile(text, "mine", "user");
    expect(file.records.map((record) => record.id)).toEqual(["good"]);
    expect(file.problems).toEqual([
      {
        collection: "mine",
        line: 3,
        id: "odd",
        code: "bad-value",
        message: '"odd" has an unknown expand value (always), so it was left out',
        severity: "error",
      },
    ]);
  });

  it.each([
    [{ prefix: 3, body: "x" }, "bad-value"],
    [{ prefix: ["a", 2], body: "x" }, "bad-value"],
    [{ prefix: "a", body: 3 }, "bad-value"],
    [{ prefix: "a", body: ["a", 2] }, "bad-value"],
    [{ prefix: "a", body: { tex: "x" } }, "bad-value"],
    [{ prefix: "a", body: { latex: 3 } }, "bad-value"],
    [{ prefix: "a", body: "x", where: "margin" }, "bad-value"],
    [{ prefix: "a", body: "x", languages: ["latex", "c"] }, "bad-value"],
    [{ prefix: "a", body: "x", languages: [] }, "bad-value"],
    [{ prefix: "a", body: "x", languages: "latex" }, "bad-value"],
    [{ prefix: "a", body: "x", inWord: "yes" }, "bad-value"],
    [{ prefix: "a", body: "x", lineStart: 1 }, "bad-value"],
    [{ prefix: "a", body: "x", priority: "high" }, "bad-value"],
    [{ prefix: "a", body: "x", typstSince: [0] }, "bad-value"],
    [{ prefix: "a", body: "x", typstSince: [0, -1] }, "bad-value"],
    [{ prefix: "a", body: "x", name: 1 }, "bad-value"],
    [{ prefix: "a", body: "x", nameKey: 1 }, "bad-value"],
    [{ prefix: "a", body: "x", description: ["x"] }, "bad-value"],
    [{ prefix: "a", body: "x", scope: 1 }, "bad-value"],
    [{ prefix: "a", body: "x", regex: "yes" }, "bad-value"],
    [{ prefix: "a" }, "no-body"],
    [{ prefix: "a", body: {} }, "no-body"],
    [{ prefix: "re:(", body: "x" }, "bad-regex"],
    [{ prefix: "re:(\\w+\\s?)+\\d\\d", body: "x" }, "bad-regex"],
    [{ prefix: "a", body: "${1/^(a+)+$/x/}" }, "bad-transform"],
    [{ prefix: "a", body: "${1:foo $1} bar" }, "bad-field"],
    [{ prefix: "a", body: "\\caption{${1:x" }, "unclosed"],
    [{ prefix: "a", body: { latex: "ok", typst: "${1/shout}" } }, "unknown-helper"],
    ["text", "entry-not-object"],
    [null, "entry-not-object"],
  ])("skips %j with a %s error", (entry, code) => {
    const file = parseSnippetFile(JSON.stringify({ x: entry }), "mine", "user");
    expect(file.records).toEqual([]);
    expect(file.problems).toEqual([expect.objectContaining({ id: "x", code, severity: "error", line: 1 })]);
    expect(file.problems[0].message).toContain('"x"');
  });

  it("skips a body with fields nested too deeply instead of throwing", () => {
    const body = Array.from({ length: 2000 }, (_, index) => `\${${index + 1}:`).join("") + "}".repeat(2000);
    const file = parseSnippetFile(JSON.stringify({ x: { prefix: "a", body } }), "mine", "user");
    expect(file.records).toEqual([]);
    expect(file.problems).toEqual([expect.objectContaining({ id: "x", code: "bad-field", severity: "error" })]);
  });

  it("shortens long values in messages", () => {
    const [problem] = problemsOf(JSON.stringify({ x: { prefix: "a", body: "x", where: "w".repeat(60) } }));
    expect(problem.message).toContain(`${"w".repeat(39)}…`);
  });

  it("warns when a user's as-you-type trigger is an ordinary word", () => {
    const entry = { prefix: "mk", body: "\\$$1\\$$0", expand: "auto", where: "text" };
    expect(problemsOf(JSON.stringify({ x: entry }))).toEqual([
      {
        collection: "mine",
        line: 1,
        id: "x",
        code: "ordinary-words",
        message: '"mk" could expand while you write ordinary words',
        severity: "warning",
      },
    ]);
    expect(problemsOf(JSON.stringify({ x: { ...entry, where: "any" } }), "project")).toHaveLength(1);
    expect(problemsOf(JSON.stringify({ x: entry }), "pack")).toEqual([]);
    expect(problemsOf(JSON.stringify({ x: entry }), "builtin")).toEqual([]);
    expect(problemsOf(JSON.stringify({ x: { ...entry, where: "math" } }))).toEqual([]);
    expect(problemsOf(JSON.stringify({ x: { ...entry, prefix: "mK" } }))).toEqual([]);
    expect(problemsOf(JSON.stringify({ x: { ...entry, expand: "tab" } }))).toEqual([]);
    expect(problemsOf(JSON.stringify({ x: { ...entry, prefix: "re:mk" } }))).toEqual([]);
    expect(problemsOf(JSON.stringify({ x: { ...entry, prefix: undefined } }))).toEqual([]);
  });

  it("warns when a regex trigger runs after every key", () => {
    const file = parseSnippetFile(JSON.stringify({ x: { prefix: "re:a.", body: "y", expand: "auto" } }), "p", "pack");
    expect(file.records).toHaveLength(1);
    expect(file.problems).toEqual([expect.objectContaining({ id: "x", code: "regex-every-key", severity: "warning" })]);
  });

  it("does not warn about a regex trigger that ends in a literal star", () => {
    expect(problemsOf(JSON.stringify({ x: { prefix: "re:x\\*", body: "y", expand: "auto" } }), "pack")).toEqual([]);
  });

  it("explains the skip of a trigger that repeats a group which repeats inside", () => {
    const [problem] = problemsOf(JSON.stringify({ x: { prefix: "re:(\\w+\\s?)+\\d\\d", body: "y" } }));
    expect(problem.message).toBe('The trigger of "x" has a repeat inside a repeated group, like (a+)+, which can freeze typing, so it was left out');
  });

  it("warns that a regex snippet uses only its first prefix", () => {
    const file = parseSnippetFile(JSON.stringify({ x: { prefix: ["re:x(\\d)", "xx", "re:y"], body: "y" } }), "p", "pack");
    expect(file.records).toHaveLength(1);
    expect(file.problems).toEqual([
      {
        collection: "p",
        line: 1,
        id: "x",
        code: "regex-aliases",
        message: '"x" has a regular expression trigger, so its other prefixes are never used',
        severity: "warning",
      },
    ]);
    expect(problemsOf(JSON.stringify({ x: { prefix: ["re:x(\\d)", "re:x(\\d)"], body: "y" } }), "pack")).toEqual([]);
  });

  it("reads [[n]] as a capture only in a regex snippet", () => {
    const literal = only(JSON.stringify({ x: { prefix: "st", body: "#strong[[1]] x" } }));
    expect(literal.bodies.default).toEqual([{ kind: "text", text: "#strong[[1]] x" }]);
    const regex = only(JSON.stringify({ x: { prefix: "re:x(\\d)", body: "[[0]]" } }), "pack");
    expect(regex.bodies.default).toEqual([{ kind: "capture", group: 1 }]);
  });
});

describe("serializeSnippetFile", () => {
  function roundTrip(text: string, layer: SnippetRecord["layer"] = "user"): void {
    const file = parseSnippetFile(text, "mine", layer);
    const again = parseSnippetFile(serializeSnippetFile(file.records, file.header), "mine", layer);
    expect(again.problems).toEqual(file.problems);
    expect(again.header).toEqual(file.header);
    expect(again.records.map((record) => ({ ...record, regex: record.regex?.source }))).toEqual(
      file.records.map((record) => ({ ...record, regex: record.regex?.source })),
    );
  }

  it("round-trips every kind of record", () => {
    roundTrip(VS_CODE_FILE);
    roundTrip(
      JSON.stringify({
        $pack: { name: "Mine", licence: "MIT" },
        frac: {
          name: "Fraction",
          nameKey: "k",
          prefix: ["//", "frac"],
          description: "d",
          body: "\\frac{$1}{$2}$0",
          expand: "auto",
          where: "math",
          languages: ["latex"],
          inWord: true,
          lineStart: true,
          priority: 1,
          typstSince: [0, 12],
        },
        sub: { prefix: "re:([A-Za-z])(\\d)", body: "[[0]]_[[1]]", expand: "auto" },
        literal: { prefix: "re:x", regex: false, body: "x" },
        per: { prefix: "thm", body: { latex: ["a", "b"], typst: "c" } },
        anyPer: { prefix: "p", body: { latex: "a" }, languages: "any" },
        none: { body: "${SELECTION}" },
      }),
      "pack",
    );
  });

  it("keeps a prototype-looking id as an ordinary key", () => {
    const text = serializeSnippetFile(parseSnippetFile('{"__proto__": {"prefix": "p", "body": "x"}}', "m", "user").records);
    expect(JSON.parse(text)).toEqual(JSON.parse('{"__proto__": {"prefix": "p", "body": "x"}}'));
  });
});
