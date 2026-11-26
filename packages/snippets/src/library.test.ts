import { describe, expect, it } from "vitest";
import { compareKeys, layerRank } from "./library";
import { library, snippetFile } from "./tests/fixtures";

const builtinAt = snippetFile("builtin-latex-at", "builtin", {
  "at.alpha": { prefix: "@a", body: "\\alpha", expand: "list", languages: ["latex"], where: "math" },
  "at.beta": { prefix: "@b", body: "\\beta", expand: "list", languages: ["latex"], where: "math" },
});
const fastMath = snippetFile("fast-math-latex", "pack", {
  "at.alpha": { prefix: "@a", body: "\\alpha", expand: "auto", languages: ["latex"], where: "math" },
  "fm.frac": { prefix: "//", body: "\\frac{$1}{$2}$0", expand: "auto", languages: ["latex"], inWord: true },
  "fm.slash": { prefix: "/", body: "\\slash", expand: "auto", languages: ["latex"] },
  "fm.to": { prefix: ["->", "to/"], body: "\\to", expand: "auto", languages: ["latex"] },
  "fm.sub": { prefix: "re:(?<![\\\\A-Za-z])([A-Za-z])(\\d)", body: "[[0]]_[[1]]", expand: "auto", languages: ["latex"] },
  "fm.hat": { prefix: "re:([A-Za-z])hat", body: "\\hat{[[0]]}", expand: "auto", languages: ["latex"] },
  "fm.bar": { prefix: "re:([A-Za-z])bar", body: "\\bar{[[0]]}", expand: "auto", languages: ["latex"], priority: 1 },
  "fm.tab": { prefix: "re:([A-Za-z])tab", body: "x", expand: "tab", languages: ["latex"] },
});
const mine = snippetFile("my-snippets", "user", {
  "fm.tab": { prefix: "ff", body: "\\dfrac{$1}{$2}$0", expand: "tab" },
  anywhere: { prefix: "zz", body: "zz" },
  wrap: { body: "\\emph{${SELECTION}}", languages: ["latex", "typst"] },
  typstOnly: { prefix: "ty", body: { typst: "#ty" } },
});

describe("buildLibrary", () => {
  it("lets a closer layer replace a record with the same id", () => {
    const snippets = library([builtinAt, fastMath, mine]);
    expect(snippets.byId("fm.tab")?.collection).toBe("my-snippets");
    expect(snippets.byId("fm.frac")?.collection).toBe("fast-math-latex");
    expect(snippets.byId("missing")).toBeUndefined();
  });

  it("uses the later file when two files of one layer share an id", () => {
    const other = snippetFile("other", "user", { anywhere: { prefix: "yy", body: "yy" } });
    expect(library([mine, other]).byId("anywhere")?.trigger).toBe("yy");
  });

  it("lets a pack replace a built-in only while the pack is on", () => {
    expect(library([builtinAt, fastMath]).byId("at.alpha")?.expand).toBe("auto");
    const off = library([builtinAt, fastMath], { disabledCollections: new Set(["fast-math-latex"]) });
    expect(off.byId("at.alpha")?.expand).toBe("list");
  });

  it("keeps a disabled collection in all only", () => {
    const snippets = library([builtinAt, mine], { disabledCollections: new Set(["builtin-latex-at"]) });
    expect(snippets.records.map((record) => record.id)).toEqual(["fm.tab", "anywhere", "wrap", "typstOnly"]);
    expect(snippets.all.map((record) => record.id)).toEqual(["at.alpha", "at.beta", "fm.tab", "anywhere", "wrap", "typstOnly"]);
  });

  it("applies an override patch and keeps the other fields", () => {
    const snippets = library([builtinAt], {
      overrides: [{ id: "at.alpha", collection: "builtin-latex-at", patch: { trigger: "@al", priority: 3, name: undefined } }],
    });
    expect(snippets.byId("at.alpha")).toMatchObject({ trigger: "@al", priority: 3, name: "at.alpha", expand: "list" });
    expect(snippets.all[0].trigger).toBe("@al");
    expect(builtinAt.records[0].trigger).toBe("@a");
  });

  it("only applies an override to its own collection", () => {
    const snippets = library([builtinAt, mine], {
      overrides: [{ id: "fm.tab", collection: "builtin-latex-at", disabled: true }],
    });
    expect(snippets.byId("fm.tab")?.collection).toBe("my-snippets");
  });

  it("hides a record whose override disables it", () => {
    const snippets = library([builtinAt, fastMath], {
      overrides: [{ id: "at.alpha", collection: "fast-math-latex", disabled: true }],
    });
    expect(snippets.byId("at.alpha")?.collection).toBe("builtin-latex-at");
    expect(snippets.all.filter((record) => record.id === "at.alpha")).toHaveLength(2);
  });

  it("recomputes the wrapper flag when an override changes the body", () => {
    const snippets = library([mine], {
      overrides: [{ id: "wrap", collection: "my-snippets", patch: { bodies: { default: [{ kind: "text", text: "x" }] } } }],
    });
    expect(snippets.byId("wrap")?.wraps).toBe(false);
  });

  it("recompiles a regex trigger an override changes", () => {
    const snippets = library([fastMath], {
      overrides: [
        { id: "fm.hat", collection: "fast-math-latex", patch: { trigger: "([A-Za-z])ht" } },
        { id: "fm.bar", collection: "fast-math-latex", patch: { trigger: null } },
        { id: "fm.sub", collection: "fast-math-latex", patch: { trigger: "(" } },
        { id: "fm.tab", collection: "fast-math-latex", patch: { trigger: "([A-Za-z])tab" } },
      ],
    });
    expect(snippets.byId("fm.hat")?.regex?.test("xht")).toBe(true);
    expect(snippets.byId("fm.bar")).toMatchObject({ trigger: null, regex: null });
    expect(snippets.byId("fm.sub")?.trigger).toBe("(?<![\\\\A-Za-z])([A-Za-z])(\\d)");
    expect(snippets.byId("fm.sub")?.regex?.test("x1")).toBe(true);
    expect(snippets.problems).toEqual([
      expect.objectContaining({ id: "fm.sub", code: "bad-regex", line: 0, collection: "fast-math-latex" }),
    ]);
  });

  it("drops a regex record that was switched off for being slow", () => {
    const snippets = library([fastMath, mine], { disabledRegex: new Set(["fm.sub", "anywhere"]) });
    expect(snippets.byId("fm.sub")).toBeUndefined();
    expect(snippets.byId("anywhere")).toBeDefined();
  });

  it("collects the problems of every file", () => {
    const broken = { collection: "broken", records: [], problems: [mine.problems, builtinAt.problems].flat() };
    const warned = snippetFile("warned", "user", { mk: { prefix: "mk", body: "x", expand: "auto" } });
    expect(library([broken, warned]).problems.map((problem) => problem.code)).toEqual(["ordinary-words"]);
  });
});

describe("forLanguage", () => {
  const snippets = library([builtinAt, fastMath, mine]);
  const latex = snippets.forLanguage("latex");

  it("memoises each language", () => {
    expect(snippets.forLanguage("latex")).toBe(latex);
  });

  it("sorts literal triggers for prefix search", () => {
    expect(latex.prefixSorted.map((record) => record.trigger)).toEqual(["->", "/", "//", "@a", "@b", "ff", "zz"]);
  });

  it("buckets as-you-type triggers by their last character, longest first", () => {
    expect(latex.autoByLastChar.get("/")?.map((record) => record.id)).toEqual(["fm.to", "fm.frac", "fm.slash"]);
    expect(latex.autoByLastChar.get(">")?.map((record) => record.id)).toEqual(["fm.to"]);
    expect(latex.autoByLastChar.get("a")?.map((record) => record.id)).toEqual(["at.alpha"]);
    expect(latex.autoByLastChar.has("f")).toBe(false);
  });

  it("buckets regex triggers by their end class", () => {
    expect(latex.regexByEnd.get("digit")?.map((record) => record.id)).toEqual(["fm.sub"]);
    expect(latex.regexByEnd.get("t")?.map((record) => record.id)).toEqual(["fm.hat"]);
    expect(latex.regexByEnd.get("r")?.map((record) => record.id)).toEqual(["fm.bar"]);
    expect(latex.regexByEnd.has("b")).toBe(false);
    expect(library([fastMath]).forLanguage("latex").regexByEnd.get("b")?.map((record) => record.id)).toEqual(["fm.tab"]);
  });

  it("lists wrappers and triggerless records", () => {
    expect(latex.wrappers.map((record) => record.id)).toEqual(["wrap"]);
    expect(latex.triggerless.map((record) => record.id)).toEqual(["wrap"]);
  });

  it("includes any-language records and only records with a body for the language", () => {
    const typst = snippets.forLanguage("typst");
    expect(typst.prefixSorted.map((record) => record.id)).toEqual(["fm.tab", "typstOnly", "anywhere"]);
    expect(typst.wrappers.map((record) => record.id)).toEqual(["wrap"]);
    expect(snippets.forLanguage("markdown").prefixSorted.map((record) => record.id)).toEqual(["fm.tab", "anywhere"]);
  });
});

describe("ordering helpers", () => {
  it("ranks layers and compares keys", () => {
    expect(["builtin", "pack", "user", "project"].map((layer) => layerRank(layer as never))).toEqual([0, 1, 2, 3]);
    expect([compareKeys("a", "b"), compareKeys("b", "a"), compareKeys("a", "a")]).toEqual([-1, 1, 0]);
  });
});
