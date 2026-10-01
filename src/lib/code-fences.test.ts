import { describe, expect, it } from "vitest";
import { lineInsideFence, scanFences } from "@/lib/code-fences";

const LINE_SEPARATOR = String.fromCodePoint(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCodePoint(0x2029);

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One mark per line: "c" for a line of a fenced code block, "." otherwise.
const marks = (markdown: string) => {
  const fences = scanFences(markdown);
  let lineFrom = 0;
  return markdown
    .split("\n")
    .map((line) => {
      const inside = lineInsideFence(fences, lineFrom, lineFrom + line.length);
      lineFrom += line.length + 1;
      return inside ? "c" : ".";
    })
    .join("");
};

describe("scanFences", () => {
  it("finds backtick and tilde fences of three or more", () => {
    expect(marks("a\n```\nb\n```\nc")).toBe(".ccc.");
    expect(marks("a\n~~~~\nb\n~~~~\nc")).toBe(".ccc.");
    expect(marks("``\nb\n``")).toBe("...");
    expect(marks("a\r\n```sh\r\nb\r\n```\r\nc")).toBe(".ccc.");
    expect(marks("a\r\n~~~\nb\r\n~~~\nc")).toBe(".ccc.");
  });

  it("accepts an info string, but no backtick in a backtick fence's info string", () => {
    expect(marks("```bash title=x\nb\n```")).toBe("ccc");
    expect(marks("```latex``` is the class.\nb")).toBe("..");
    expect(marks("~~~ a`b\nc\n~~~")).toBe("ccc");
  });

  it("closes only on the same character, at least as long, with nothing after", () => {
    expect(marks("````\nb\n```\n````\nc")).toBe("cccc.");
    expect(marks("```\nb\n~~~\n``` not yet\n```   \nc")).toBe("ccccc.");
  });

  it("runs an unclosed fence to the end of the text", () => {
    expect(marks("a\n```sh\nb\n\nc")).toBe(".cccc");
    expect(marks("```")).toBe("c");
  });

  it("allows up to three spaces of indent, counted from the list item that holds the fence", () => {
    expect(marks("   ```\nb\n   ```\nc")).toBe("ccc.");
    expect(marks("text\n\n    ```\nb\n    ```")).toBe(".....");
    expect(marks("1. a\n\n    ```\n    b\n    ```\nc")).toBe("..ccc.");
    expect(marks("1.  Run:\n    ```sh\n    make\n    ```\n2.  Done")).toBe(".ccc.");
    expect(marks("- a\n\n      ```\n      b")).toBe("....");
    expect(marks("1. a\n   - b\n\n     ```\n     c\n     ```")).toBe("...ccc");
    expect(marks("1. Run\n   ```sh\n\n   make\n   ```\n2. Compile")).toBe(".cccc.");
    // A fence under an outer item, after a nested one.
    expect(marks("*   a\n    *   b\n    ```sh\n    cd x\n    ```\n*   c")).toBe("..ccc.");
    expect(marks("10. a\n    - b\n    ```\n    x\n    ```")).toBe("..ccc");
    // Text back at the margin ends the list, so four spaces are indented code.
    expect(marks("1. a\n\ntext\n\n    ```\n    b\n    ```")).toBe(".......");
  });

  it("finds a fence that starts a list item, or sits in a blockquote", () => {
    expect(marks("- ```sh\n  make\n  ```\nafter")).toBe("ccc.");
    expect(marks("> ```\n> b\n> ```\nc")).toBe("ccc.");
    expect(marks(">```\n>b\n>```")).toBe("ccc");
    expect(marks("> > ~~~\n> > b\n> > ~~~")).toBe("ccc");
    // Inside a top-level fence a ">" line is code, not a new blockquote.
    expect(marks("```\n> b\n```")).toBe("ccc");
    expect(marks("para\n```\nb\n```")).toBe(".ccc");
  });

  it("opens no fence on a line that holds a carriage return or a Unicode line end", () => {
    expect(marks("```sh\rx\nb")).toBe("..");
    expect(marks(`~~~${LINE_SEPARATOR}\nb`)).toBe("..");
    expect(marks(`\`\`\`${PARAGRAPH_SEPARATOR}sh\nb`)).toBe("..");
  });

  it("opens a fence exactly where the single pattern it replaced did, on generated lines", () => {
    // The opening pattern before the rest of the line moved out of it, kept
    // as the oracle. Its `(.*)$` tail backtracks into the run on a long line.
    const previousOpening = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/u;
    const random = seededRandom(20260930);
    const pick = (choices: readonly string[]) => choices[Math.floor(random() * choices.length)];
    const many = (choices: readonly string[], most: number) =>
      Array.from({ length: Math.floor(random() * (most + 1)) }, () => pick(choices)).join("");
    // No "\n", which would end the line, and nothing that opens a blockquote or a list item.
    const rest = [" ", "\t", "`", "~", "a", "\r", LINE_SEPARATOR, PARAGRAPH_SEPARATOR, "\u{1F600}", "\uD800", "\uDC00"];
    const mismatches: string[] = [];
    let opened = 0;
    let lineEnds = 0;
    for (let round = 0; round < 100_000; round += 1) {
      const run = pick(["`", "~"]).repeat(Math.floor(random() * 7));
      const line = many([" ", "\t"], 5) + run + many(rest, 8);
      // scanFences drops the "\r" of a "\r\n" line end before it looks at the line.
      const content = line.replace(/\r$/u, "");
      const start = previousOpening.exec(content);
      const opens = start !== null && !(start[1].startsWith("`") && start[2].includes("`"));
      const expected = opens ? [{ from: line.indexOf(start[1]), to: line.length, complete: false }] : [];
      if (JSON.stringify(scanFences(line)) !== JSON.stringify(expected)) mismatches.push(line);
      if (opens) opened += 1;
      else if (/^[ \t]{0,3}(?:`{3}|~{3})/u.test(content) && /[\r\u2028\u2029]/u.test(content)) lineEnds += 1;
    }
    expect(mismatches).toEqual([]);
    // The lines cover both outcomes, including a run that a line end follows.
    expect(opened).toBeGreaterThan(5_000);
    expect(lineEnds).toBeGreaterThan(5_000);
  });

  it("stays linear on a long run that a line end follows", () => {
    // The previous pattern took seconds on each of these.
    const started = performance.now();
    expect(scanFences(`${"`".repeat(50_000)}${LINE_SEPARATOR}`)).toEqual([]);
    expect(scanFences(`${"~".repeat(50_000)}\rx`)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
