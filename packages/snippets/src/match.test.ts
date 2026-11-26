import { afterEach, describe, expect, it, vi } from "vitest";
import type { LanguageIndex } from "./library";
import { autoCandidates, hintCandidate, listMatches, type MatchContext, placeAllows, tabCandidates } from "./match";
import { library, snippetFile } from "./tests/fixtures";
import type { ResolvedPlace, SnippetLanguage, SnippetRecord } from "./types";

function indexOf(entries: Record<string, unknown>, language: SnippetLanguage = "latex", layer: SnippetRecord["layer"] = "pack"): LanguageIndex {
  return library([snippetFile("test", layer, entries)]).forLanguage(language);
}

function ctx(lineBefore: string, extra: Partial<MatchContext> = {}): MatchContext {
  return { language: "latex", lineBefore, ...extra };
}

const noSlow = () => {
  throw new Error("no regex should be slow here");
};

function auto(index: LanguageIndex, line: string, extra: Partial<MatchContext> = {}) {
  return autoCandidates(index, ctx(line, extra), line.slice(-1), noSlow).map((hit) => ({
    id: hit.record.id,
    from: hit.from,
    captures: hit.captures,
  }));
}

const fastMath = indexOf({
  frac: { prefix: "//", body: "\\frac{$1}{$2}$0", expand: "auto", inWord: true },
  postfix: {
    prefix: "re:(?<![\\\\A-Za-z])(\\d+|[A-Za-z]|\\\\[A-Za-z]+)/",
    body: "\\frac{[[0]]}{$1}$0",
    expand: "auto",
    inWord: true,
  },
  sub: { prefix: "re:(?<![\\\\A-Za-z])([A-Za-z])(\\d)", body: "[[0]]_[[1]]", expand: "auto", inWord: true },
  dot: { prefix: "re:([A-Za-z])dot", body: "\\dot{[[0]]}", expand: "auto", inWord: true },
  mk: { prefix: "mk", body: "\\$$1\\$$0", expand: "auto" },
  dm: { prefix: "dm", body: "\\[$1\\]$0", expand: "auto", lineStart: true },
  in: { prefix: "in", body: "\\in", expand: "auto", inWord: true },
  sum: { prefix: "sum", body: "\\sum", expand: "auto", inWord: true },
  sr: { prefix: "sr", body: "^2", expand: "auto", inWord: true },
  alpha: { prefix: "@a", body: "\\alpha", expand: "auto", inWord: true },
  to: { prefix: ["->", "to"], body: "\\to", expand: "auto" },
  list: { prefix: "ls", body: "x", expand: "list" },
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("autoCandidates", () => {
  it("fires // inside a word", () => {
    expect(auto(fastMath, "$a+b//")).toEqual([{ id: "frac", from: 4, captures: [] }]);
  });

  it("prefers the postfix fraction after a term", () => {
    expect(auto(fastMath, "$x/")).toEqual([{ id: "postfix", from: 1, captures: ["x"] }]);
    expect(auto(fastMath, "$3/")).toEqual([{ id: "postfix", from: 1, captures: ["3"] }]);
    expect(auto(fastMath, "$12/")).toEqual([{ id: "postfix", from: 1, captures: ["12"] }]);
    expect(auto(fastMath, "$\\alpha/")).toEqual([{ id: "postfix", from: 1, captures: ["\\alpha"] }]);
    expect(auto(fastMath, "$ab/")).toEqual([]);
  });

  it("captures the auto subscript", () => {
    expect(auto(fastMath, "$x1")).toEqual([{ id: "sub", from: 1, captures: ["x", "1"] }]);
    expect(auto(fastMath, "$ab1")).toEqual([]);
    expect(auto(fastMath, "$\\alpha1")).toEqual([]);
  });

  it("never fires inside a word unless the record allows it", () => {
    expect(auto(fastMath, "remark")).toEqual([]);
    expect(auto(fastMath, "2mk")).toEqual([]);
    expect(auto(fastMath, "\\mk")).toEqual([]);
    expect(auto(fastMath, "a mk")).toEqual([{ id: "mk", from: 2, captures: [] }]);
    expect(auto(fastMath, "mk")).toEqual([{ id: "mk", from: 0, captures: [] }]);
    expect(auto(fastMath, "xsr")).toEqual([{ id: "sr", from: 1, captures: [] }]);
  });

  it("never fires in a LaTeX command name", () => {
    expect(auto(fastMath, "$\\sin")).toEqual([]);
    expect(auto(fastMath, "$\\cdot")).toEqual([]);
    expect(auto(fastMath, "$\\sum")).toEqual([]);
    expect(auto(fastMath, "$\\\\sum")).toEqual([{ id: "sum", from: 3, captures: [] }]);
    expect(auto(fastMath, "$x\\//")).toEqual([]);
    expect(auto(fastMath, "$xdot")).toEqual([{ id: "dot", from: 1, captures: ["x"] }]);
  });

  it("never fires in an @name token unless the trigger starts with @", () => {
    expect(auto(fastMath, "see @sec:sum")).toEqual([]);
    expect(auto(fastMath, "$x@a")).toEqual([{ id: "alpha", from: 2, captures: [] }]);
    expect(auto(fastMath, "$\\beta@a")).toEqual([{ id: "alpha", from: 6, captures: [] }]);
  });

  it("checks aliases and the start of the line", () => {
    expect(auto(fastMath, "a ->")).toEqual([{ id: "to", from: 2, captures: [] }]);
    expect(auto(fastMath, "a to")).toEqual([{ id: "to", from: 2, captures: [] }]);
    expect(auto(fastMath, "  dm")).toEqual([{ id: "dm", from: 2, captures: [] }]);
    expect(auto(fastMath, "a dm")).toEqual([]);
  });

  it("uses the longest key of a record that fits", () => {
    const index = indexOf({ slash: { prefix: ["/", "//"], body: "x", expand: "auto", inWord: true } });
    expect(auto(index, "a//")).toEqual([{ id: "slash", from: 1, captures: [] }]);
  });

  it("ignores list records, other characters and a last character the line does not end with", () => {
    expect(auto(fastMath, "a ls")).toEqual([]);
    expect(autoCandidates(fastMath, ctx("a x1"), "/", noSlow)).toEqual([]);
  });

  it("orders by priority, then length, then layer", () => {
    const index = library([
      snippetFile("pack", "pack", {
        short: { prefix: "o", body: "1", expand: "auto", inWord: true },
        long: { prefix: "oo", body: "2", expand: "auto", inWord: true },
        same: { prefix: "zo", body: "3", expand: "auto", inWord: true },
      }),
      snippetFile("mine", "user", {
        mine: { prefix: "zo", body: "4", expand: "auto", inWord: true },
        top: { prefix: "re:z(o)", body: "5", expand: "auto", inWord: true, priority: 1 },
      }),
    ]).forLanguage("latex");
    expect(auto(index, "zoo").map((hit) => hit.id)).toEqual(["long", "short"]);
    expect(auto(index, "zo").map((hit) => hit.id)).toEqual(["top", "mine", "same", "short"]);
  });

  it("hides a record that needs a newer Typst", () => {
    const index = indexOf({ s: { prefix: "zz", body: "x", expand: "auto", typstSince: [0, 13] } }, "typst");
    expect(auto(index, "zz", { language: "typst", typstVersion: [0, 12] })).toEqual([]);
    expect(auto(index, "zz", { language: "typst", typstVersion: [0, 13] })).toHaveLength(1);
    expect(auto(index, "zz", { language: "typst", typstVersion: [1, 0] })).toHaveLength(1);
    expect(auto(index, "zz", { language: "typst" })).toHaveLength(1);
  });

  it("looks back over at most 100 characters and skips empty matches", () => {
    const index = indexOf({
      far: { prefix: "re:q.{99}", body: "x", expand: "auto", inWord: true },
      empty: { prefix: "re:b*", body: "x", expand: "auto", inWord: true },
    });
    expect(auto(index, `q${"x".repeat(100)}`)).toEqual([]);
    expect(auto(index, `q${"x".repeat(99)}`)).toEqual([{ id: "far", from: 0, captures: [] }]);
  });

  it("uses the letter and every-key buckets", () => {
    const index = indexOf({
      letter: { prefix: "re:#\\p{L}", body: "x", expand: "auto", inWord: true },
      every: { prefix: "re:%.", body: "y", expand: "auto", inWord: true },
      star: { prefix: "re:x\\*", body: "z", expand: "auto", inWord: true },
    });
    expect(auto(index, "#é")).toEqual([{ id: "letter", from: 0, captures: [] }]);
    expect(auto(index, "%!")).toEqual([{ id: "every", from: 0, captures: [] }]);
    expect(auto(index, "x*")).toEqual([{ id: "star", from: 0, captures: [] }]);
  });

  it("reports a slow pattern once and then stops running it", () => {
    const index = indexOf({ slow: { prefix: "re:(a+)+b\\d", body: "x", expand: "auto" } });
    const onSlow = vi.fn();
    const line = `${"a".repeat(22)}1`;
    expect(autoCandidates(index, ctx(line), "1", onSlow)).toEqual([]);
    expect(onSlow).toHaveBeenCalledTimes(1);
    expect(onSlow.mock.calls[0][0].id).toBe("slow");
    const exec = vi.spyOn(index.regexByEnd.get("digit")?.[0].regex as RegExp, "exec");
    expect(autoCandidates(index, ctx(line), "1", onSlow)).toEqual([]);
    expect(exec).not.toHaveBeenCalled();
    expect(onSlow).toHaveBeenCalledTimes(1);
  });

  it("times every regex run", () => {
    const index = indexOf({ sub: { prefix: "re:([a-z])(\\d)", body: "x", expand: "auto" } });
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(2.5);
    const onSlow = vi.fn();
    expect(autoCandidates(index, ctx("x1"), "1", onSlow)).toHaveLength(1);
    expect(onSlow).toHaveBeenCalledTimes(1);
  });
});

describe("tabCandidates", () => {
  const index = indexOf({
    fig: { prefix: "fig", body: "f", lineStart: true },
    figs: { prefix: ["figs", "subfig"], body: "fs" },
    ig: { prefix: "ig", body: "i", inWord: true },
    listed: { prefix: "ls", body: "l", expand: "list" },
    typed: { prefix: "ty", body: "t", expand: "auto" },
    hat: { prefix: "re:([a-z])ht", body: "\\hat{[[0]]}", inWord: true },
  });

  const tab = (line: string) => tabCandidates(index, ctx(line)).map((hit) => [hit.record.id, hit.from]);

  it("finds exact Tab triggers and regex Tab triggers", () => {
    expect(tab("fig")).toEqual([
      ["fig", 0],
      ["ig", 1],
    ]);
    expect(tab("a fig")).toEqual([["ig", 3]]);
    expect(tab("a subfig")).toEqual([
      ["figs", 2],
      ["ig", 6],
    ]);
    expect(tab("xht")).toEqual([["hat", 0]]);
  });

  it("ignores list and as-you-type records and an empty line", () => {
    expect(tab("a ls")).toEqual([]);
    expect(tab("a ty")).toEqual([]);
    expect(tab("")).toEqual([]);
  });

  it("passes slow regex reports on", () => {
    const slowIndex = indexOf({ slow: { prefix: "re:(a+)+b\\d", body: "x" } });
    const onSlow = vi.fn();
    tabCandidates(slowIndex, ctx(`${"a".repeat(22)}2`), onSlow);
    expect(onSlow).toHaveBeenCalledTimes(1);
    tabCandidates(slowIndex, ctx(`${"a".repeat(22)}2`));
  });
});

describe("listMatches", () => {
  const index = indexOf({
    section: { prefix: "/section", body: "s", expand: "list", inWord: true },
    subsection: { prefix: ["/subsection", "/sub"], body: "ss", expand: "list", inWord: true },
    fig: { prefix: "fig", body: "f" },
    auto: { prefix: "/auto", body: "a", expand: "auto", inWord: true },
    later: { prefix: "/later", body: "l", expand: "list", inWord: true, typstSince: [9, 0] },
  });

  const list = (typed: string, line = typed, extra: Partial<MatchContext> = {}) =>
    listMatches(index, ctx(line, extra), typed).map((record) => record.id);

  it("lists records whose trigger or alias starts with the typed text", () => {
    expect(list("/")).toEqual(["later", "section", "subsection"]);
    expect(list("/su")).toEqual(["subsection"]);
    expect(list("/s", "a/s")).toEqual(["section", "subsection"]);
    expect(list("")).toEqual(["later", "section", "subsection", "fig"]);
    expect(list("/", "/", { typstVersion: [0, 13] })).toEqual(["section", "subsection"]);
  });

  it("checks word boundaries at the typed text", () => {
    expect(list("fi", "a fi")).toEqual(["fig"]);
    expect(list("fi", "afi")).toEqual([]);
  });
});

describe("hintCandidate", () => {
  const hint = (index: LanguageIndex, line: string, extra: Partial<MatchContext> = {}) => {
    const found = hintCandidate(index, ctx(line, extra));
    return found && { id: found.record.id, typed: found.typed, rest: found.rest, exact: found.exact };
  };

  it("offers the rest of a single candidate after two letters", () => {
    const index = indexOf({ fig: { prefix: "fig", body: "f", lineStart: true } });
    expect(hint(index, "fi")).toEqual({ id: "fig", typed: "fi", rest: "g", exact: false });
    expect(hint(index, "f")).toBeNull();
    expect(hint(index, "a fi")).toBeNull();
    expect(hint(index, "")).toBeNull();
  });

  it("lets an exact trigger win over longer ones", () => {
    const index = indexOf({ fig: { prefix: "fig", body: "f" }, figs: { prefix: "figs", body: "fs" } });
    expect(hint(index, "fig")).toEqual({ id: "fig", typed: "fig", rest: "", exact: true });
    expect(hint(index, "a fig")).toEqual({ id: "fig", typed: "fig", rest: "", exact: true });
  });

  it("offers the shortest trigger when it starts every other candidate", () => {
    const index = indexOf({ fig: { prefix: "fig", body: "f" }, figs: { prefix: "figs", body: "fs" }, figref: { prefix: "figref", body: "r" } });
    expect(hint(index, "fi")).toEqual({ id: "fig", typed: "fi", rest: "g", exact: false });
  });

  it("offers nothing when the candidates part ways or share a trigger", () => {
    const apart = indexOf({ fig: { prefix: "fig", body: "f" }, fiat: { prefix: "fiat", body: "a" } });
    expect(hint(apart, "fi")).toBeNull();
    const twins = indexOf({ one: { prefix: "fig", body: "1" }, two: { prefix: "fig", body: "2" } });
    expect(hint(twins, "fi")).toBeNull();
  });

  it("counts a record with two matching keys once", () => {
    const index = indexOf({ fig: { prefix: ["figure", "fig"], body: "f" } });
    expect(hint(index, "fi")).toEqual({ id: "fig", typed: "fi", rest: "g", exact: false });
  });

  it("skips as-you-type records, newer Typst records and keys that do not fit", () => {
    const index = indexOf(
      {
        auto: { prefix: "fig", body: "f", expand: "auto" },
        later: { prefix: "figs", body: "f", typstSince: [1, 0] },
        word: { prefix: "fog", body: "f" },
      },
      "typst",
    );
    expect(hint(index, "fig", { language: "typst", typstVersion: [0, 13] })).toBeNull();
    expect(hint(index, "fo", { language: "typst", typstVersion: [0, 13] })).toEqual({
      id: "word",
      typed: "fo",
      rest: "g",
      exact: false,
    });
    expect(hint(index, "xfo", { language: "typst" })).toBeNull();
    expect(hint(index, "\\fo", { language: "typst" })).toBeNull();
  });

  it("never hints in a command name", () => {
    const index = indexOf({ fig: { prefix: "fig", body: "f", inWord: true } });
    expect(hint(index, "\\fig")).toBeNull();
    expect(hint(index, "\\fi")).toBeNull();
  });
});

describe("placeAllows", () => {
  const places: ResolvedPlace[] = ["text", "inline-math", "display-math", "code"];
  it.each([
    ["any", [true, true, true, true]],
    ["text", [true, false, false, false]],
    ["math", [false, true, true, false]],
    ["inline-math", [false, true, false, false]],
    ["display-math", [false, false, true, false]],
    ["code", [false, false, false, true]],
  ])("checks %s", (place, expected) => {
    const record = { place } as SnippetRecord;
    expect(places.map((resolved) => placeAllows(record, resolved))).toEqual(expected);
  });
});
