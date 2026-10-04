import { describe, expect, it } from "vitest";
import {
  matchTypstCode,
  matchTypstContent,
  matchTypstMath,
  skipTypstCode,
  skipTypstString,
  typstArguments,
  typstIdentifierEndAt,
  typstStringLiteral,
  typstStringValue,
} from "./typst-scan";

const BACKSLASH = String.fromCodePoint(92);
const unicodeEscape = (body: string) => `"${BACKSLASH}u${body}"`;

describe("typstStringValue", () => {
  it.each([
    ['"plain"', "plain"],
    ['  "padded"  ', "padded"],
    ['""', ""],
    [String.raw`"a\nb\tc\rd"`, "a\nb\tc\rd"],
    [String.raw`"q\"x\\y"`, String.raw`q"x\y`],
    [String.raw`"\q"`, "q"],
    [unicodeEscape("{1F600}!"), `${String.fromCodePoint(0x1f600)}!`],
    [unicodeEscape("{41}{42}"), "A{42}"],
    [unicodeEscape("0041"), "u0041"],
  ])("decodes %s", (source, expected) => {
    expect(typstStringValue(source)).toBe(expected);
  });

  it.each(["plain", '"a" + "b"', '"unterminated', String.raw`"a\"`, unicodeEscape("{zz}"), unicodeEscape("{41")])(
    "rejects %s",
    (source) => {
      expect(typstStringValue(source)).toBeNull();
    },
  );
});

describe("typstStringLiteral", () => {
  it("escapes backslashes, quotes and newlines", () => {
    expect(typstStringLiteral('a"b\\c\nd')).toBe(String.raw`"a\"b\\c\nd"`);
  });

  it("round-trips through typstStringValue", () => {
    const value = 'path\\to "file"\nnext';
    expect(typstStringValue(typstStringLiteral(value))).toBe(value);
  });
});

describe("typstIdentifierEndAt", () => {
  it.each([
    ["my-var x", 0, 6],
    ["_a_b", 0, 4],
    ["1abc", 0, 0],
    ["", 0, 0],
    ["x.y", 2, 3],
  ])("ends the identifier in %j from %i at %i", (source, from, end) => {
    expect(typstIdentifierEndAt(source, from)).toBe(end);
  });
});

describe("skipTypstString", () => {
  it("skips escaped quotes and runs to the end of an unclosed string", () => {
    expect(skipTypstString(String.raw`"a\"b" rest`, 0)).toBe(6);
    expect(skipTypstString('"open', 0)).toBe(5);
  });
});

describe("skipTypstCode", () => {
  it.each([
    ["a line comment", "// line\nx", 7],
    ["nested block comments", "/* a /* b */ c */x", 17],
    ["an unclosed block comment", "/* never", 8],
    ["a lone slash", "/x", 1],
    ["a string", '"str"x', 5],
    ["inline raw text", "`raw` x", 5],
    ["empty raw text", "``x", 2],
    ["a raw block", "```py\ncode\n``` tail", 14],
    ["unclosed raw text", "`unclosed", 9],
    ["a content block", "[a [b] c]x", 9],
    ["an inline equation", "$x^2$ y", 5],
    ["nested parentheses", "(a, (b))x", 8],
    ["a code block", "{ x }y", 5],
    ["a plain character", "x", 1],
  ])("skips %s", (_name, source, end) => {
    expect(skipTypstCode(source, 0)).toBe(end);
  });
});

describe("matchTypstCode", () => {
  it("stops at a mismatched closer and at the end of the source", () => {
    expect(matchTypstCode("(a]", 1, ")")).toBe(2);
    expect(matchTypstCode("(abc", 1, ")")).toBe(4);
  });
});

describe("matchTypstContent", () => {
  it.each([
    ["an escaped bracket", String.raw`a \] b] rest`, 7],
    ["a comment that hides a bracket", "a // c ] \n]x", 11],
    ["a URL that looks like a comment", "https://x.org]", 14],
    ["raw text that hides a bracket", "`]` ]", 5],
    ["math that hides a bracket", "$ ] $ ]", 7],
    ["an embedded call with arguments and a body", '#f("]")[x] ]', 12],
    ["an embedded field access chain", "#a.b.c ]", 8],
    ["a sentence-ending dot after a variable", "#a. ]", 5],
    ["an embedded expression", "#(1+2) ]", 8],
    ["a bare hash", "# ]", 3],
    ["nested content", "[x] ]", 5],
  ])("matches past %s", (_name, source, end) => {
    expect(matchTypstContent(source, 0)).toBe(end);
  });

  it("runs to the end of unclosed content", () => {
    expect(matchTypstContent("abc", 0)).toBe(3);
    expect(matchTypstContent("#abc", 0)).toBe(4);
  });
});

describe("matchTypstMath", () => {
  it.each([
    ["a comment", "// $\n$", 6],
    ["an escaped dollar", String.raw`\$ $`, 4],
    ["a string", '"$" $', 5],
    ["an embedded variable", "#x $", 4],
  ])("closes the equation after %s", (_name, source, end) => {
    expect(matchTypstMath(source, 0)).toBe(end);
  });

  it("runs to the end of an unclosed equation", () => {
    expect(matchTypstMath("abc", 0)).toBe(3);
  });
});

describe("typstArguments", () => {
  it("splits positional and named arguments", () => {
    const source = "f(a, b: 1, c: (1, 2))";
    expect(typstArguments(source, 1)).toEqual({
      args: [
        { from: 2, to: 3, name: null, value: { from: 2, to: 3 } },
        { from: 5, to: 9, name: "b", value: { from: 8, to: 9 } },
        { from: 11, to: 20, name: "c", value: { from: 14, to: 20 } },
      ],
      end: 21,
    });
  });

  it("ignores empty slots and trailing commas", () => {
    expect(typstArguments("f()", 1)).toEqual({ args: [], end: 3 });
    expect(typstArguments("f(a,)", 1)?.args.map((arg) => arg.from)).toEqual([2]);
  });

  it("rejects a non-call, a mismatched closer and an unclosed call", () => {
    expect(typstArguments("x", 0)).toBeNull();
    expect(typstArguments("f(a]", 1)).toBeNull();
    expect(typstArguments("f(a, b", 1)).toBeNull();
  });
});
