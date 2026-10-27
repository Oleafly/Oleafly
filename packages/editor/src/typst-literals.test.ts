import type { Parser } from "@lezer/common";
import { beforeAll, describe, expect, it } from "vitest";
import { loadTypstParser } from "./typst";
import { hasErrorNode } from "./typst-arguments";
import {
  decodeTypstBool,
  decodeTypstNumber,
  decodeTypstString,
  encodeTypstBool,
  encodeTypstNumber,
  encodeTypstString,
  sanitizeTypstContent,
} from "./typst-literals";

let parser: Parser;

beforeAll(async () => {
  parser = await loadTypstParser();
});

function parsesAsOneString(literal: string): boolean {
  const doc = `#f(${literal})`;
  const tree = parser.parse(doc);
  const strings = tree.topNode.getChild("FuncCall")?.getChild("Args")?.getChildren("Str") ?? [];
  const [str] = strings;
  return strings.length === 1 && str.from === 3 && str.to === 3 + literal.length && !hasErrorNode(tree.topNode);
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

describe("Typst string literals", () => {
  it.each([
    ['"plain"', "plain"],
    ['""', ""],
    [String.raw`"a \"quote\" and \\ slash"`, 'a "quote" and \\ slash'],
    [String.raw`"line\nbreak\r\ttab"`, "line\nbreak\r\ttab"],
    [String.raw`"smile \u{1F600} and \u{e9}"`, "smile 😀 and é"],
    ['"emoji 😀 kept"', "emoji 😀 kept"],
    [String.raw`"bad \q escape"`, String.raw`bad \q escape`],
    [String.raw`"\u{110000}"`, String.raw`\u{110000}`],
    [String.raw`"\u{d800}"`, String.raw`\u{d800}`],
    [String.raw`"\u{}x"`, String.raw`\u{}x`],
    [String.raw`"\u{zz}"`, String.raw`\u{zz}`],
    [String.raw`"A\u{41"`, "AA"],
    [String.raw`"\u0041"`, String.raw`\u0041`],
  ])("decodes %s the way Typst does", (literal, value) => {
    expect(decodeTypstString(literal)).toBe(value);
  });

  it.each([
    "plain",
    '"unterminated',
    String.raw`"escaped close\"`,
    '"inner " quote"',
    '"a" + "b"',
  ])("refuses %s", (literal) => {
    expect(decodeTypstString(literal)).toBeNull();
  });

  it.each([
    ["plain", '"plain"'],
    ['say "hi"', String.raw`"say \"hi\""`],
    ["back\\slash", String.raw`"back\\slash"`],
    ["a\nb\rc\td", String.raw`"a\nb\rc\td"`],
    ["nul\u0000bell\u0007del\u007f", String.raw`"nul\u{0}bell\u{7}del\u{7f}"`],
    ["#[]$*_{} 😀", '"#[]$*_{} 😀"'],
  ])("encodes %j", (value, literal) => {
    expect(encodeTypstString(value)).toBe(literal);
  });

  it("round-trips 1,000 random strings through the Typst parser", () => {
    const alphabet = ["\\", '"', "\n", "\r", "\t", "[", "]", "#", "$", "*", "_", "{", "}", "\u0000", "😀", "a", " "];
    const random = seeded(340);
    for (let round = 0; round < 1_000; round += 1) {
      let value = "";
      const length = Math.floor(random() * 24);
      for (let index = 0; index < length; index += 1) value += alphabet[Math.floor(random() * alphabet.length)];
      const literal = encodeTypstString(value);
      expect(parsesAsOneString(literal), JSON.stringify(literal)).toBe(true);
      expect(decodeTypstString(literal)).toBe(value);
    }
  });
});

describe("Typst content markup", () => {
  it.each([
    ["keep [this] balanced", "keep [this] balanced"],
    ["a ] b", String.raw`a \] b`],
    ["open [ only", String.raw`open \[ only`],
    [String.raw`already \] escaped`, String.raw`already \] escaped`],
    ["*bold* and #emph[x]", "*bold* and #emph[x]"],
  ])("sanitizes %j", (markup, expected) => {
    expect(sanitizeTypstContent(markup)).toBe(expected);
  });
});

describe("Typst numbers and booleans", () => {
  it.each([
    ["3", true, 3],
    ["-2", true, -2],
    ["- 2", true, -2],
    ["0x1F", true, 31],
    ["0o17", true, 15],
    ["0b101", false, 5],
    ["2.5", false, 2.5],
    ["-2.5e3", false, -2500],
    [".5", false, 0.5],
    ["7", false, 7],
  ])("decodes %s (integer %s)", (source, integer, value) => {
    expect(decodeTypstNumber(source, integer)).toBe(value);
  });

  it.each([
    ["2.5", true],
    ["1pt", false],
    ["50%", false],
    ["x", false],
    ["99999999999999999999", true],
    ["", false],
  ])("refuses %s (integer %s)", (source, integer) => {
    expect(decodeTypstNumber(source, integer)).toBeNull();
  });

  it.each([
    [3, true, "3"],
    [-4, true, "-4"],
    [2.5, false, "2.5"],
    [0.1 + 0.2, false, "0.30000000000000004"],
    [1e21, false, "1e21"],
    [1e-7, false, "1e-7"],
    [5, false, "5"],
  ])("encodes %s (integer %s)", (value, integer, source) => {
    expect(encodeTypstNumber(value, integer)).toBe(source);
    expect(decodeTypstNumber(source, integer)).toBe(value);
  });

  it.each([
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
    [Number.NEGATIVE_INFINITY, true],
    [2.5, true],
    [2 ** 60, true],
  ])("refuses to encode %s (integer %s)", (value, integer) => {
    expect(encodeTypstNumber(value, integer)).toBeNull();
  });

  it("reads and writes booleans", () => {
    expect(decodeTypstBool("true")).toBe(true);
    expect(decodeTypstBool(" false ")).toBe(false);
    expect(decodeTypstBool("none")).toBeNull();
    expect(encodeTypstBool(true)).toBe("true");
    expect(encodeTypstBool(false)).toBe("false");
  });
});
