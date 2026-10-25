import { describe, expect, it } from "vitest";
import { trimCharacter, trimTrailingCharacter } from "./trim-character";

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
  });
});

describe("trimTrailingCharacter", () => {
  it("drops the run at the end and keeps the start", () => {
    expect(trimTrailingCharacter("/a/b///", "/")).toBe("/a/b");
    expect(trimTrailingCharacter("/", "/")).toBe("");
    expect(trimTrailingCharacter("a", "/")).toBe("a");
  });
});
