import { describe, expect, it } from "vitest";
import { trimCharacter, trimTrailingCharacter, trimTrailingCharacters } from "./trim-character";

describe("trimCharacter", () => {
  it("drops the runs at both ends only", () => {
    expect(trimCharacter("--my-paper--", "-")).toBe("my-paper");
    expect(trimCharacter("/a/b/", "/")).toBe("a/b");
    expect(trimCharacter("paper", "-")).toBe("paper");
    expect(trimCharacter("----", "-")).toBe("");
    expect(trimCharacter("", "-")).toBe("");
  });

  it("stays linear on a long run that isn't at the end", () => {
    const value = `${"/".repeat(200_000)}x`;
    expect(trimCharacter(value, "/")).toBe("x");
    expect(trimTrailingCharacter(value, "/")).toBe(value);
    expect(trimTrailingCharacters(value, "/\\")).toBe(value);
  });
});

describe("trimTrailingCharacter", () => {
  it("drops the run at the end and keeps the start", () => {
    expect(trimTrailingCharacter("/a/b///", "/")).toBe("/a/b");
    expect(trimTrailingCharacter("/", "/")).toBe("");
    expect(trimTrailingCharacter("a", "/")).toBe("a");
  });
});

describe("trimTrailingCharacters", () => {
  it("drops a trailing run of any of the characters and keeps the rest", () => {
    expect(trimTrailingCharacters("see ~/paper.tex).", ".,;:!?)]}")).toBe("see ~/paper.tex");
    expect(trimTrailingCharacters("a. .b. . ", ". ")).toBe("a. .b");
    expect(trimTrailingCharacters("line \t \t", " \t")).toBe("line");
    expect(trimTrailingCharacters("...", ".")).toBe("");
    expect(trimTrailingCharacters("", ".")).toBe("");
    expect(trimTrailingCharacters("word", "")).toBe("word");
  });
});
