import { describe, expect, it } from "vitest";
import { parseJsonc, parseJsoncDocument } from "./jsonc";
import { idLine, lineAt } from "./locate";

describe("parseJsonc", () => {
  it("reads plain JSON like JSON.parse", () => {
    const text = '{"a": [1, -2.5e3, true, false, null, "x\\n\\u00e9\\"\\\\\\/\\b\\f\\r\\t"], "b": {}}';
    expect(parseJsonc(text)).toEqual({ value: JSON.parse(text) });
  });

  it("strips comments outside strings and accepts trailing commas", () => {
    const text = [
      "﻿// Place your snippets here.",
      "/* a block",
      "   comment */",
      "{",
      '  "url": "http://example // not a comment /* nor this */",',
      '  "list": [1, 2,],',
      "  // a comment between keys",
      '  "last": 3, /* trailing */',
      "}",
      "// end",
    ].join("\n");
    expect(parseJsonc(text)).toEqual({
      value: { url: "http://example // not a comment /* nor this */", list: [1, 2], last: 3 },
    });
  });

  it("keeps the last value of a repeated key and never touches the prototype", () => {
    const result = parseJsonc('{"a": 1, "a": 2, "__proto__": {"polluted": true}}');
    expect("value" in result && (result.value as Record<string, unknown>).a).toBe(2);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect("value" in result && Object.keys(result.value as object)).toEqual(["a", "__proto__"]);
  });

  it.each([
    ['{"a": 1 "b": 2}', 8, "Expected a comma or a closing brace"],
    ["[1 2]", 3, "Expected a comma or a closing bracket"],
    ['{"a" 1}', 5, "Expected a colon after the key"],
    ["{a: 1}", 1, "Expected a key in double quotes"],
    ['{"a": }', 6, "Expected a value"],
    ["", 0, "Expected a value"],
    ["-", 0, "Expected a value"],
    ['"abc', 0, "Unterminated string"],
    ['"a\nb"', 0, "Unterminated string"],
    ['"\\x"', 1, "Invalid escape in a string"],
    ['"\\u12"', 1, "Invalid escape in a string"],
    ['"\\', 1, "Invalid escape in a string"],
    ["/* open", 0, "Unterminated comment"],
    ["{} x", 3, "Unexpected text after the end"],
    ["01", 1, "Unexpected text after the end"],
  ])("reports %j at offset %i", (text, offset, message) => {
    expect(parseJsonc(text)).toEqual({ error: { offset, message } });
  });

  it("refuses deep nesting instead of overflowing the stack", () => {
    const text = "[".repeat(5000) + "]".repeat(5000);
    expect(parseJsonc(text)).toEqual({ error: { offset: 257, message: "Too deeply nested" } });
  });

  it("records where each top-level key starts", () => {
    const text = '{\n  "one": {"inner": 1},\n  // note\n  "two": 2\n}';
    const document = parseJsoncDocument(text);
    expect("keys" in document && [...document.keys]).toEqual([
      ["one", 4],
      ["two", 37],
    ]);
  });
});

describe("locate", () => {
  it("turns an offset into a 1-based line", () => {
    expect(lineAt("a\nb\r\nc", 0)).toBe(1);
    expect(lineAt("a\nb\r\nc", 2)).toBe(2);
    expect(lineAt("a\nb\r\nc", 5)).toBe(3);
    expect(lineAt("a\nb", 99)).toBe(2);
    expect(lineAt("a\nb", -4)).toBe(1);
  });

  it("finds the line of a snippet id", () => {
    const text = '{\n  "first": {},\n  "second": {"first": 1}\n}';
    expect(idLine(text, "second")).toBe(3);
    expect(idLine(text, "first")).toBe(2);
    expect(idLine(text, "missing")).toBe(1);
    expect(idLine("{ broken", "first")).toBe(1);
  });
});
