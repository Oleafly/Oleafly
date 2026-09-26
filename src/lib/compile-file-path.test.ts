import { describe, expect, it } from "vitest";
import { compilePathResolver, resolveCompilePath } from "./compile-file-path";

const project = [
  "main.tex",
  "cast/a/intro.tex",
  "cast/b/intro.tex",
  "kapitoly/úvod.tex",
  "sections/methods.tex",
];

describe("resolveCompilePath", () => {
  it("prefers the exact project-relative path over a shared basename", () => {
    expect(resolveCompilePath("cast/b/intro.tex", project)).toBe("cast/b/intro.tex");
    expect(resolveCompilePath("./cast/a/intro.tex", project)).toBe("cast/a/intro.tex");
    expect(resolveCompilePath("cast\\b\\intro.tex", project)).toBe("cast/b/intro.tex");
  });

  it("refuses to guess between files that share a basename", () => {
    expect(resolveCompilePath("intro.tex", project)).toBeNull();
    expect(resolveCompilePath("cast/c/intro.tex", project)).toBeNull();
  });

  it("matches an absolute path by its longest project suffix", () => {
    expect(resolveCompilePath("/Users/me/thesis/cast/a/intro.tex", project)).toBe(
      "cast/a/intro.tex",
    );
    expect(resolveCompilePath("/Users/me/thesis/./main.tex", project)).toBe("main.tex");
  });

  it("adds .tex to the extensionless names TeX logs for \\input", () => {
    expect(resolveCompilePath("kapitoly/úvod", project)).toBe("kapitoly/úvod.tex");
    expect(resolveCompilePath("./sections/methods", project)).toBe("sections/methods.tex");
  });

  it("matches NFC names from TeX against NFD names on disk", () => {
    const decomposed = "kapitoly/u\u0301vod.tex";
    expect(resolveCompilePath("kapitoly/úvod.tex", ["main.tex", decomposed])).toBe(decomposed);
    expect(resolveCompilePath("úvod.tex", ["main.tex", decomposed])).toBe(decomposed);
  });

  it("finds a unique file below the directory a relative path was written from", () => {
    expect(resolveCompilePath("a/intro.tex", project)).toBe("cast/a/intro.tex");
  });

  it("counts a path listed twice as one candidate", () => {
    const resolve = compilePathResolver(["main.tex", "kapitoly/úvod.tex", "kapitoly/úvod.tex"]);
    expect(resolve("úvod.tex")).toBe("kapitoly/úvod.tex");
    expect(resolve("úvod")).toBe("kapitoly/úvod.tex");
  });

  it("does not match files outside the project", () => {
    const resolve = compilePathResolver(project);
    expect(resolve("/usr/local/texlive/2025/texmf-dist/tex/latex/base/article.cls")).toBeNull();
    expect(resolve("")).toBeNull();
  });
});
