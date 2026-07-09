import { describe, it, expect } from "vitest";
import { runRefsRules, type RefsContext } from "./refs-rules";

const ctx = (over: Partial<RefsContext> = {}): RefsContext => ({
  definedLabels: [],
  bibKeys: [],
  bibLoaded: true,
  projectFiles: [],
  duplicateDois: [],
  ...over,
});

const has = (src: string, c: RefsContext, id: string) => runRefsRules(src, c).some((f) => f.id === id);

describe("undefined citations", () => {
  it("flags a \\cite whose key is in no .bib", () => {
    expect(has("\\cite{smith21}", ctx({ bibKeys: [] }), "refs-undefined-cite")).toBe(true);
  });
  it("accepts a \\cite whose key exists", () => {
    expect(has("\\cite{smith21}", ctx({ bibKeys: ["smith21"] }), "refs-undefined-cite")).toBe(false);
  });
  it("flags the missing key in a multi-key cite", () => {
    const out = runRefsRules("\\cite{a,b}", ctx({ bibKeys: ["a"] }));
    expect(out.filter((f) => f.id === "refs-undefined-cite")).toHaveLength(1);
    expect(out.find((f) => f.id === "refs-undefined-cite")?.title).toContain("b");
  });
  it("does not check citations when no .bib is loaded (avoids false positives)", () => {
    expect(has("\\cite{smith21}", ctx({ bibLoaded: false }), "refs-undefined-cite")).toBe(false);
  });
  it("ignores \\nocite{*}", () => {
    expect(has("\\nocite{*}", ctx(), "refs-undefined-cite")).toBe(false);
  });
});

describe("undefined references", () => {
  it("flags a \\ref with no matching \\label", () => {
    expect(has("\\ref{fig:2}", ctx(), "refs-undefined-ref")).toBe(true);
  });
  it("accepts a \\ref whose label is defined in the corpus", () => {
    expect(has("\\ref{fig:2}", ctx({ definedLabels: ["fig:2"] }), "refs-undefined-ref")).toBe(false);
  });
  it("accepts a label defined in the same source", () => {
    expect(has("\\label{fig:1}\\ref{fig:1}", ctx(), "refs-undefined-ref")).toBe(false);
  });
  it("handles \\cref with multiple labels", () => {
    const out = runRefsRules("\\cref{a,b}", ctx({ definedLabels: ["a"] }));
    expect(out.filter((f) => f.id === "refs-undefined-ref")).toHaveLength(1);
  });
});

describe("duplicate labels", () => {
  it("flags a label defined twice in the source", () => {
    expect(has("\\label{x}\\label{x}", ctx(), "refs-duplicate-label")).toBe(true);
  });
  it("does not flag distinct labels", () => {
    expect(has("\\label{a}\\label{b}", ctx(), "refs-duplicate-label")).toBe(false);
  });
});

describe("duplicate bib entries", () => {
  it("flags two entries that share a DOI", () => {
    const out = runRefsRules("", ctx({ duplicateDois: [{ doi: "10.1/x", keys: ["smith21", "smithdup"] }] }));
    const f = out.find((x) => x.id === "refs-duplicate-bib");
    expect(f).toBeDefined();
    expect(f!.title).toContain("smith21");
    expect(f!.title).toContain("smithdup");
  });
  it("does not fire when there are no duplicates", () => {
    expect(runRefsRules("", ctx()).some((x) => x.id === "refs-duplicate-bib")).toBe(false);
  });
});

describe("missing assets", () => {
  it("flags an \\includegraphics whose file is not in the project", () => {
    expect(has("\\includegraphics{fig.png}", ctx({ projectFiles: [] }), "refs-missing-asset")).toBe(true);
  });
  it("accepts an image that exists", () => {
    expect(has("\\includegraphics{fig.png}", ctx({ projectFiles: ["fig.png"] }), "refs-missing-asset")).toBe(false);
  });
  it("resolves an extensionless image against a real file", () => {
    expect(has("\\includegraphics{fig}", ctx({ projectFiles: ["fig.pdf"] }), "refs-missing-asset")).toBe(false);
  });
  it("resolves an image in a subfolder by path suffix", () => {
    expect(has("\\includegraphics{fig.png}", ctx({ projectFiles: ["images/fig.png"] }), "refs-missing-asset")).toBe(false);
  });
  it("flags a missing \\input", () => {
    expect(has("\\input{sec1}", ctx({ projectFiles: [] }), "refs-missing-asset")).toBe(true);
  });
  it("accepts an \\input that resolves to a .tex", () => {
    expect(has("\\input{sec1}", ctx({ projectFiles: ["sec1.tex"] }), "refs-missing-asset")).toBe(false);
  });
});

describe("finding shape", () => {
  it("tags findings with the refs lens and a source range", () => {
    const out = runRefsRules("\\ref{missing}", ctx());
    const f = out.find((x) => x.id === "refs-undefined-ref");
    expect(f?.lens).toBe("refs");
    expect(typeof f?.from).toBe("number");
  });
});
