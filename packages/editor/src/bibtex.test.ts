import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import { describe, expect, it } from "vitest";
import { bibtexLanguage } from "./bibtex";

function tokens(doc: string): Array<[string, string]> {
  const state = EditorState.create({ doc, extensions: [bibtexLanguage()] });
  const tree = ensureSyntaxTree(state, doc.length, 1_000);
  if (!tree) throw new Error("The BibTeX tree did not finish parsing");
  const found: Array<[string, string]> = [];
  highlightTree(tree, classHighlighter, (from, to, classes) => {
    found.push([doc.slice(from, to), classes.replace("tok-", "")]);
  });
  return found;
}

describe("BibTeX highlighting", () => {
  it("highlights a parenthesised entry with escaped quotes, numbers, macros and concatenation", () => {
    expect(tokens(`@article(key, title = "A \\"q\\" b", year = 2020, month = jan # " 1")`)).toEqual([
      ["@article", "keyword"],
      ["(", "punctuation"],
      ["key", "variableName"],
      ["title", "propertyName"],
      ["=", "operator"],
      [`"A \\"q\\" b"`, "string"],
      ["year", "propertyName"],
      ["=", "operator"],
      ["2020", "number"],
      ["month", "propertyName"],
      ["=", "operator"],
      ["jan", "variableName"],
      ["#", "operator"],
      [`" 1"`, "string"],
      [")", "punctuation"],
    ]);
  });

  it("reads string definitions as fields and preamble bodies as values", () => {
    expect(tokens(`@string{foo = "bar"}`).map(([, kind]) => kind)).toEqual([
      "keyword",
      "punctuation",
      "propertyName",
      "operator",
      "string",
      "punctuation",
    ]);
    expect(tokens(`@preamble("x" # y)`)).toEqual([
      ["@preamble", "keyword"],
      ["(", "punctuation"],
      [`"x"`, "string"],
      ["#", "operator"],
      ["y", "variableName"],
      [")", "punctuation"],
    ]);
  });

  it("treats a comment directive as a comment up to its balanced closing delimiter", () => {
    expect(tokens(`@comment{ nested {a} \\} } after`)).toEqual([
      ["@comment{", "comment"],
      ["nested {a} \\} }", "comment"],
    ]);
    expect(tokens(`@comment(text (inner) \\) more) @misc{k}`)).toEqual([
      ["@comment(text (inner) \\) more)", "comment"],
      ["@misc", "keyword"],
      ["{", "punctuation"],
      ["k", "variableName"],
      ["}", "punctuation"],
    ]);
  });

  it("highlights line comments inside an entry and braced values across lines", () => {
    expect(tokens("@book{k, % note\n title = {a {b} c\n d}}")).toEqual([
      ["@book", "keyword"],
      ["{", "punctuation"],
      ["k", "variableName"],
      ["% note", "comment"],
      ["title", "propertyName"],
      ["=", "operator"],
      ["{a {b} c", "string"],
      [" d}", "string"],
      ["}", "punctuation"],
    ]);
  });

  it("recovers from entries that are missing keys, values or separators", () => {
    expect(tokens("@article{, title}").map(([text]) => text)).toEqual(["@article", "{", "title", "}"]);
    expect(tokens("@article{}")).toEqual([
      ["@article", "keyword"],
      ["{}", "punctuation"],
    ]);
    expect(tokens("@article{k, title ,}").map(([text]) => text)).toEqual(["@article", "{", "k", "title", "}"]);
    expect(tokens("@article{k, title = }").at(-1)).toEqual(["}", "punctuation"]);
    expect(tokens("@article{k, title = ! }").at(-1)).toEqual(["}", "punctuation"]);
    expect(tokens("@article{k, title = {a} , year = 1 }").map(([, kind]) => kind)).toEqual([
      "keyword",
      "punctuation",
      "variableName",
      "propertyName",
      "operator",
      "string",
      "propertyName",
      "operator",
      "number",
      "punctuation",
    ]);
    expect(tokens("@article x {k}").map(([text]) => text)).toEqual(["@article", "{", "k", "}"]);
  });

  it("leaves text outside entries unstyled and keeps unterminated strings as strings", () => {
    expect(tokens("loose text @ 12")).toEqual([]);
    expect(tokens(`@article{k, title = "open\nstill`).slice(-2)).toEqual([
      [`"open`, "string"],
      ["still", "string"],
    ]);
    expect(tokens(`@article{k, title = "a\\`).at(-1)).toEqual([`"a\\`, "string"]);
  });
});
