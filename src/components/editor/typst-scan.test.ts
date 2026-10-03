import { describe, expect, it } from "vitest";
import { typstStringLiteral, typstStringValue } from "./typst-scan";

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
