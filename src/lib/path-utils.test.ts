import { describe, expect, it } from "vitest";
import { basename, dirname, isSeparator } from "./path-utils";

describe("isSeparator", () => {
  it("accepts either slash and nothing else", () => {
    expect(isSeparator("/")).toBe(true);
    expect(isSeparator("\\")).toBe(true);
    expect(isSeparator(":")).toBe(false);
    expect(isSeparator(undefined)).toBe(false);
  });
});

describe("basename", () => {
  it("returns the last segment of a project path", () => {
    expect(basename("chapters/intro.tex")).toBe("intro.tex");
    expect(basename("main.tex")).toBe("main.tex");
    expect(basename("/abs/dir/file.bib")).toBe("file.bib");
  });

  it("splits Windows paths and mixed separators", () => {
    expect(basename(String.raw`C:\Users\ada\paper\main.tex`)).toBe("main.tex");
    expect(basename(String.raw`figures\plots/fig.pdf`)).toBe("fig.pdf");
    expect(basename(String.raw`figures/plots\fig.pdf`)).toBe("fig.pdf");
  });

  it("keeps the empty tail of a path that ends in a separator", () => {
    expect(basename("figures/")).toBe("");
    expect(basename("")).toBe("");
  });
});

describe("dirname", () => {
  it("returns everything before the last segment", () => {
    expect(dirname("chapters/part/intro.tex")).toBe("chapters/part");
    expect(dirname("main.tex")).toBe("");
    expect(dirname("/main.tex")).toBe("");
  });

  it("splits Windows paths and mixed separators", () => {
    expect(dirname(String.raw`C:\paper\main.tex`)).toBe(String.raw`C:\paper`);
    expect(dirname(String.raw`a\b/c.tex`)).toBe(String.raw`a\b`);
  });
});
