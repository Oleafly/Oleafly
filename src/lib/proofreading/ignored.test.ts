import { afterEach, describe, expect, it } from "vitest";
import {
  clearWordsIgnoredHere,
  ignoreWordHere,
  isFindingSuppressedHere,
  isSessionIgnoredWord,
  isWordIgnoredHere,
  suppressFindingHere,
} from "./ignored";

afterEach(() => clearWordsIgnoredHere());

describe("session word ignores", () => {
  it("keeps one project's decision out of another project", () => {
    ignoreWordHere("alpha", "main.tex", "Qwertzuiopz");
    expect(isWordIgnoredHere("alpha", "main.tex", "Qwertzuiopz")).toBe(
      true,
    );
    expect(isWordIgnoredHere("beta", "main.tex", "Qwertzuiopz")).toBe(
      false,
    );
    expect(isWordIgnoredHere(null, "main.tex", "Qwertzuiopz")).toBe(false);
  });

  it("keeps one file's decision out of another file", () => {
    ignoreWordHere("alpha", "main.tex", "Qwertzuiopz");
    expect(isWordIgnoredHere("alpha", "intro.tex", "Qwertzuiopz")).toBe(
      false,
    );
  });

  it("matches the word after punctuation and case are normalized", () => {
    ignoreWordHere("alpha", "main.tex", "“Qwertzuiopz”,");
    expect(isWordIgnoredHere("alpha", "main.tex", "qwertzuiopz")).toBe(
      true,
    );
  });

  it("clears one file, one project, or everything", () => {
    ignoreWordHere("alpha", "main.tex", "one");
    ignoreWordHere("alpha", "intro.tex", "two");
    ignoreWordHere("beta", "main.tex", "three");

    clearWordsIgnoredHere("alpha", "main.tex");
    expect(isWordIgnoredHere("alpha", "main.tex", "one")).toBe(false);
    expect(isWordIgnoredHere("alpha", "intro.tex", "two")).toBe(true);

    clearWordsIgnoredHere("alpha");
    expect(isWordIgnoredHere("alpha", "intro.tex", "two")).toBe(false);
    expect(isWordIgnoredHere("beta", "main.tex", "three")).toBe(true);

    clearWordsIgnoredHere();
    expect(isWordIgnoredHere("beta", "main.tex", "three")).toBe(false);
  });
});

describe("session finding suppressions", () => {
  it("keeps one project's dismissal out of another project", () => {
    suppressFindingHere("alpha", "main.tex", "RepeatedWords:abcd1234");
    expect(
      isFindingSuppressedHere(
        "alpha",
        "main.tex",
        "RepeatedWords:abcd1234",
      ),
    ).toBe(true);
    expect(
      isFindingSuppressedHere(
        "beta",
        "main.tex",
        "RepeatedWords:abcd1234",
      ),
    ).toBe(false);
  });

  it("ignores an empty key", () => {
    suppressFindingHere("alpha", "main.tex", "");
    expect(isFindingSuppressedHere("alpha", "main.tex", "")).toBe(false);
  });

  it("is cleared alongside the ignored words", () => {
    suppressFindingHere("alpha", "main.tex", "RepeatedWords:abcd1234");
    clearWordsIgnoredHere("alpha", "main.tex");
    expect(
      isFindingSuppressedHere(
        "alpha",
        "main.tex",
        "RepeatedWords:abcd1234",
      ),
    ).toBe(false);
  });
});

describe("isSessionIgnoredWord", () => {
  it("passes over acronyms, numbers, and known tooling words", () => {
    expect(isSessionIgnoredWord("LaTeX")).toBe(true);
    expect(isSessionIgnoredWord("IEEE")).toBe(true);
    expect(isSessionIgnoredWord("H100")).toBe(true);
    expect(isSessionIgnoredWord("Qwertzuiopz")).toBe(false);
  });
});
