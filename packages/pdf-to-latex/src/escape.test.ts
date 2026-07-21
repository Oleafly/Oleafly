import { describe, expect, it } from "vitest";
import { escapeLatex, restoreUrlsInTex } from "./escape";

describe("escapeLatex", () => {
  it("escapes all ten LaTeX specials", () => {
    expect(escapeLatex("100% of $5 & #1_a {b} ~x ^y \\z")).toBe(
      "100\\% of \\$5 \\& \\#1\\_a \\{b\\} \\textasciitilde{}x \\textasciicircum{}y \\textbackslash{}z",
    );
  });

  it("passes plain text through", () => {
    expect(escapeLatex("hello world")).toBe("hello world");
  });
});

describe("restoreUrlsInTex", () => {
  it("wraps an escaped url in \\url with raw characters", () => {
    const escaped = escapeLatex("see https://a.b/c_d#e then text");
    expect(restoreUrlsInTex(escaped)).toBe("see \\url{https://a.b/c_d#e} then text");
  });

  it("handles urls with percent and ampersand", () => {
    const escaped = escapeLatex("go to https://x.y/p?a=1&b=2%20c now");
    expect(restoreUrlsInTex(escaped)).toBe("go to \\url{https://x.y/p?a=1&b=2%20c} now");
  });

  it("leaves url-free text alone", () => {
    expect(restoreUrlsInTex("plain \\textbf{text}")).toBe("plain \\textbf{text}");
  });
});
