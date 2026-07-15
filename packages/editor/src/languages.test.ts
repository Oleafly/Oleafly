import { describe, expect, it } from "vitest";
import { languageForPath } from "./languages";

describe("languageForPath", () => {
  it("loads Typst support case-insensitively", () => {
    expect(languageForPath("main.typ")).not.toBeNull();
    expect(languageForPath("chapters/INTRO.TYP")).not.toBeNull();
  });

  it("does not treat unrelated suffixes as Typst", () => {
    expect(languageForPath("main.typ.txt")).toBeNull();
  });
});
