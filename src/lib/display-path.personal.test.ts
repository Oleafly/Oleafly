import { afterEach, describe, expect, it } from "vitest";
import {
  personalParts,
  resetDisplayHomes,
  setDisplayHomes,
} from "@/lib/display-path";

afterEach(() => resetDisplayHomes());

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

function marked(text: string, values?: readonly string[]): string[] {
  return personalParts(text, values)
    .filter((part) => part.personal)
    .map((part) => part.text);
}

describe("personalParts", () => {
  it("returns the text as one plain part when nothing is personal", () => {
    expect(personalParts("Compiled in 2 s")).toEqual([{ text: "Compiled in 2 s", personal: false }]);
    expect(personalParts("")).toEqual([]);
  });

  it("marks home paths and absolute paths, and keeps the text around them", () => {
    const parts = personalParts("Wrote ~/paper/main.pdf and /opt/tex/bin/latexmk.");
    expect(parts.map((part) => part.text).join("")).toBe(
      "Wrote ~/paper/main.pdf and /opt/tex/bin/latexmk.",
    );
    expect(marked("Wrote ~/paper/main.pdf and /opt/tex/bin/latexmk.")).toEqual([
      "~/paper/main.pdf",
      "/opt/tex/bin/latexmk",
    ]);
    expect(marked("(/usr/local/texlive/article.cls)")).toEqual(["/usr/local/texlive/article.cls"]);
    expect(marked("home is ~")).toEqual(["~"]);
  });

  it("marks Windows drive, UNC and verbatim paths", () => {
    expect(marked(String.raw`at C:\Users\Ada\paper\main.tex`)).toEqual([
      String.raw`C:\Users\Ada\paper\main.tex`,
    ]);
    expect(marked("at D:/texlive/bin")).toEqual(["D:/texlive/bin"]);
    expect(marked(String.raw`share \\server\papers\draft`)).toEqual([String.raw`\\server\papers\draft`]);
  });

  it("leaves URLs, fractions, slash commands and LaTeX ties alone", () => {
    expect(marked("See https://example.com/a/b")).toEqual([]);
    expect(marked("Use 1/2 or and/or")).toEqual([]);
    expect(marked("Type /compact to shrink")).toEqual([]);
    expect(marked(String.raw`Fig.~\ref{a}`)).toEqual([]);
  });

  it("marks the account name from the home folder as a whole word", () => {
    setDisplayHomes(["/Users/ada"]);
    expect(marked("Signed in as ada on this Mac")).toEqual(["ada"]);
    expect(marked("adamant and Ada stay")).toEqual([]);
  });

  it("ignores case for a Windows account name", () => {
    setDisplayHomes([String.raw`C:\Users\Ada`]);
    expect(marked("user ada")).toEqual(["ada"]);
  });

  it("marks email addresses, such as a commit author's", () => {
    expect(marked("Author: Ada Lovelace <ada.l+git@example.co.uk>")).toEqual(["ada.l+git@example.co.uk"]);
    expect(marked("Use @mentions or user@host")).toEqual([]);
  });

  it("marks the extra values it is given", () => {
    expect(marked("Uses 1.2 GB in total", ["1.2 GB"])).toEqual(["1.2 GB"]);
    expect(marked("12 projects", ["2"])).toEqual([]);
  });

  it("leaves off the punctuation that ends a path exactly as the pattern it replaced did", () => {
    // The trailing-punctuation pattern before the trim became a loop, kept
    // as the oracle. It retries from each mark of a run that does not reach
    // the end.
    const previousTrailingPunctuation = /[.,;:!?)\]}]+$/u;
    const random = seededRandom(20260930);
    const pick = (choices: readonly string[]) => choices[Math.floor(random() * choices.length)];
    // Every one of these continues a path, so the whole string is one path.
    const tail = [".", ",", ";", ":", "!", "?", ")", "]", "}", "a", "/", "(", "[", "{", "-", "\u00e9", "\u{1F600}"];
    const starts = ["/opt/tex", "~/paper", String.raw`C:\Users\Ada`, String.raw`\\server\share`];
    const mismatches: string[] = [];
    let trimmed = 0;
    for (let round = 0; round < 50_000; round += 1) {
      const length = Math.floor(random() * 13);
      const path = pick(starts) + Array.from({ length }, () => pick(tail)).join("");
      const expected = path.replace(previousTrailingPunctuation, "");
      if (JSON.stringify(marked(path)) !== JSON.stringify([expected])) mismatches.push(path);
      if (expected !== path) trimmed += 1;
    }
    expect(mismatches).toEqual([]);
    expect(trimmed).toBeGreaterThan(10_000);
  });

  it("stays linear on a long run of punctuation inside a path", () => {
    // The previous pattern took seconds on each of these.
    const path = `/opt/tex/${".".repeat(50_000)}x`;
    const started = performance.now();
    expect(marked(path)).toEqual([path]);
    expect(marked(`${path}.)`)).toEqual([path]);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
