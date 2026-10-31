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

// The seeded fuzz runs in under half a second here; a loaded CI runner can take ten times that.
const FUZZ_TIMEOUT_MS = 60_000;

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
    // Only the brackets Typst leaves unmatched are escaped.
    ["See #emph[this] and note 3]", String.raw`See #emph[this] and note 3\]`],
    ["[a] ] [b", String.raw`[a] \] \[b`],
    [String.raw`a \\] b`, String.raw`a \\\] b`],
    ["Price 5\\", "Price 5\\\\"],
    ["C:\\dir\\\\", "C:\\dir\\\\"],
    ["use `]` here ]", String.raw`use ${"`]`"} here \]`],
    ["```\n]]\n``` [", "```\n]]\n``` \\["],
    ['#badge("]") and #badge("[")', '#badge("]") and #badge("[")'],
    ['[ #badge("]") ]', '[ #badge("]") ]'],
    ["$[0, 1)$ and $(0, 1]$ ]", String.raw`$[0, 1)$ and $(0, 1]$ \]`],
    ["a [b // ]\n c] d", "a [b // ]\n c] d"],
    ["/* ] */ ]", String.raw`/* ] */ \]`],
    ["[https://example.com]", "[https://example.com]"],
    ["see https://example.com/a] here", String.raw`see https://example.com/a\] here`],
    ["price $5", String.raw`price \$5`],
    ["$x$ costs $5", String.raw`$x$ costs \$5`],
    ["in $M [a] and [b", String.raw`in \$M [a] and \[b`],
    ["$5 [", String.raw`\$5 \[`],
    ["a//b", String.raw`a\//b`],
    ["note // ]", String.raw`note \// \]`],
    ["keep // note\nnext", "keep // note\nnext"],
    ["a /* b", String.raw`a \/\* b`],
    ["a */ b", String.raw`a \*/ b`],
    ["a /* b */ c", "a /* b */ c"],
    ["use `code", String.raw`use \`code`],
    ["```py x", String.raw`\`\`\`py x`],
    ["$a // b", String.raw`\$a \// b`],
    ["#f(a) // c", String.raw`#f(a) \// c`],
    ["x // y\\", String.raw`x \// y\\`],
  ])("sanitizes %j", (markup, expected) => {
    expect(sanitizeTypstContent(markup)).toBe(expected);
  });

  const PARTS = [
    "word", "*bold*", "_em_", "`]`", "```\n]]\n```", "`` ``", String.raw`\]`, String.raw`\\`, String.raw`\#`,
    '#badge("]")', '#f("a]b", x: [c])', "#emph[in]", "#f[a][b]", '#a.b("[")', "$[0, 1)$", '$ "]" $', "$ #box[x] $",
    "// note ]\n", "/* ] [ */", "https://x.com/[a]", "#(1 + (2))", '#{ "]" }', "[nested [text]]", "\n",
    '#link("https://x.com")[site]', "#f(/* ) */ 1)", "#f(`)`)",
  ];
  const STRAYS = ["[", "]", "`", "```", "// x", "/* x", "*/"];

  function wrapsCleanly(content: string): boolean {
    const doc = `#box[${content}]`;
    const tree = parser.parse(doc);
    const block = tree.topNode.getChild("FuncCall")?.getChild("Args")?.getChild("ContentBlock");
    return !hasErrorNode(tree.topNode) && block?.from === 4 && block.to === doc.length;
  }

  it("keeps 2,000 random bodies whole inside brackets, and verbatim when nothing is unmatched", () => {
    const random = seeded(345);
    for (let round = 0; round < 2_000; round += 1) {
      let strays = false;
      const parts = Array.from({ length: 1 + Math.floor(random() * 8) }, () => {
        if (random() >= 0.2) return PARTS[Math.floor(random() * PARTS.length)];
        strays = true;
        return STRAYS[Math.floor(random() * STRAYS.length)];
      });
      const dollar = random() < 0.15 ? ` $ ${PARTS[Math.floor(random() * PARTS.length)]}` : "";
      const trailing = random() < 0.1;
      const markup = `${parts.join(" ")}${dollar}${trailing ? " \\" : ""}`;
      const sanitized = sanitizeTypstContent(markup);
      expect(wrapsCleanly(sanitized), JSON.stringify(sanitized)).toBe(true);
      expect(sanitizeTypstContent(sanitized)).toBe(sanitized);
      if (!strays && !dollar && !trailing) expect(sanitized).toBe(markup);
    }
  }, FUZZ_TIMEOUT_MS);
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
    ["10000000000000000", false, 1e16],
    ["99999999999999999999", false, 1e20],
    ["-9007199254740993", false, -9_007_199_254_740_992],
  ])("decodes %s (integer %s)", (source, integer, value) => {
    expect(decodeTypstNumber(source, integer)).toBe(value);
  });

  it.each([
    ["2.5", true],
    ["1pt", false],
    ["50%", false],
    ["x", false],
    ["99999999999999999999", true],
    ["9007199254740993", true],
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
    [1e16, false, "1e16"],
    [-2.5e17, false, "-2.5e17"],
    [123_456_789_012_345_680, false, "1.2345678901234568e17"],
    [1e15, false, "1e15"],
    [1e-6, false, "0.000001"],
    [1000, false, "1000"],
    [0.001, false, "0.001"],
    [1234.5, false, "1234.5"],
    [0.05, false, "0.05"],
  ])("encodes %s (integer %s)", (value, integer, source) => {
    expect(encodeTypstNumber(value, integer)).toBe(source);
    expect(decodeTypstNumber(source, integer)).toBe(value);
  });

  it("writes float values the parser reads back as the same float or a short integer", () => {
    for (let exponent = -9; exponent <= 22; exponent += 1) {
      for (const mantissa of [1, 1.5, 7.25, 9.999]) {
        const value = mantissa * 10 ** exponent;
        const literal = encodeTypstNumber(value, false) as string;
        const tree = parser.parse(`#f(${literal})`);
        const kind = tree.topNode.getChild("FuncCall")?.getChild("Args")?.getChild("LeftParen")?.nextSibling?.name;
        expect(hasErrorNode(tree.topNode), literal).toBe(false);
        expect(kind === "Float" || (kind === "Int" && literal.length < 16), literal).toBe(true);
        expect(decodeTypstNumber(literal, false), literal).toBe(value);
      }
    }
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
