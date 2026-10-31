import { describe, expect, it } from "vitest";
import {
  autolinkRanges,
  bracketedCitationRanges,
  htmlCommentRanges,
  htmlTagRanges,
  maskMarkdown,
} from "./markdown-mask";

const ORACLES: Array<[string, (text: string) => Array<[number, number]>, RegExp]> = [
  ["html comments", htmlCommentRanges, /<!--[\s\S]*?-->/gu],
  ["html tags", htmlTagRanges, /<\/?[A-Za-z][^>\n]*>/gu],
  ["autolinks", autolinkRanges, /<(?:https?:\/\/|mailto:)[^>\n]+>/giu],
  [
    "bracketed citations",
    bracketedCitationRanges,
    /\[(?:[^\]\n@]|@(?![-\p{L}\p{N}_:.#/+]))*@[-\p{L}\p{N}_:.#/+]+(?![-\p{L}\p{N}_:.#/+])[^\]\n]*\]/gu,
  ],
];

const PIECES = ["<", ">", "!", "--", "-", "/", "a", "Z", "1", " ", "\n", "[", "]", "@", "k", ":", "http://", "HTTPS://", "mailto:", "x"];

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

function regexRanges(pattern: RegExp, text: string): Array<[number, number]> {
  return [...text.matchAll(pattern)].map((match) => [match.index, match.index + match[0].length]);
}

describe("markdown mask scanners", () => {
  for (const [name, scan, pattern] of ORACLES) {
    it(`finds exactly what the old ${name} pattern found`, () => {
      const random = seeded(name.length * 7_919);
      for (let round = 0; round < 5_000; round++) {
        let text = "";
        const length = Math.floor(random() * 24);
        for (let index = 0; index < length; index++) text += PIECES[Math.floor(random() * PIECES.length)];
        expect(scan(text), JSON.stringify(text)).toEqual(regexRanges(pattern, text));
      }
    });
  }

  it("stays linear on openers that never close", () => {
    const inputs = [
      "<!--".repeat(50_000),
      "<a ".repeat(50_000),
      "<http://".repeat(30_000),
      "<mailto:".repeat(30_000),
      "\\[".repeat(80_000),
      `${"[".repeat(80_000)}]`,
      `${"<".repeat(80_000)}>`,
    ];
    for (const input of inputs) {
      const started = performance.now();
      maskMarkdown(input);
      expect(performance.now() - started).toBeLessThan(5_000);
    }
  });

  it("still masks comments, tags, autolinks and bracketed citations", () => {
    const input = "A <!-- note --> b <span>c</span> <https://x.org> [see @knuth84, p. 3] d";
    const masked = maskMarkdown(input);
    expect(masked).toHaveLength(input.length);
    expect(masked.replaceAll(/\s+/gu, " ").trim()).toBe("A b c d");
  });
});
