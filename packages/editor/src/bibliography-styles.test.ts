import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  enclosingFrames,
  setTypstCslStyleProvider,
  setTypstStyleVersionProvider,
  typstBibliographyStyles,
  typstStyleArgumentAt,
} from "./bibliography-styles";
import { typstBibliographyStyleCompletions } from "./typst-bibliography-style-completions";
import { installEnglishEditorMessages } from "./test-messages";

beforeAll(() => installEnglishEditorMessages());

afterEach(() => {
  setTypstCslStyleProvider(() => []);
  setTypstStyleVersionProvider(() => null);
});

function complete(doc: string, explicit = false): CompletionResult | null {
  const result = typstBibliographyStyleCompletions(
    new CompletionContext(EditorState.create({ doc }), doc.length, explicit),
  );
  if (result instanceof Promise) throw new Error("expected a synchronous result");
  return result;
}

function labels(result: CompletionResult | null): string[] {
  return result?.options.map((option) => option.label) ?? [];
}

describe("typstBibliographyStyles", () => {
  it("lists the styles each Typst version accepts", () => {
    const latest = typstBibliographyStyles(null, "bibliography").map((style) => style.name);
    expect(latest).toContain("nlm-citation-sequence");
    expect(latest).toContain("ieee");
    expect(latest).toContain("vancouver");
    expect(latest).not.toContain("alphanumeric");
    expect(latest).toHaveLength(92);

    const v14 = typstBibliographyStyles("0.14.2", "bibliography").map((style) => style.name);
    expect(v14).toContain("chicago-shortened-notes");
    expect(v14).not.toContain("nlm-citation-sequence");
    expect(v14).not.toContain("cse-name-year");
    expect(v14).toHaveLength(88);

    const v13 = typstBibliographyStyles("0.13.1", "bibliography").map((style) => style.name);
    expect(v13).toContain("vancouver");
    expect(v13).not.toContain("chicago-shortened-notes");
    expect(v13).not.toContain("modern-humanities-research-association-notes");
    expect(v13).toHaveLength(86);

    expect(typstBibliographyStyles("0.15.0-rc1", "bibliography")).toHaveLength(92);
    expect(typstBibliographyStyles("not a version", "bibliography")).toHaveLength(92);
  });

  it("offers citation-only styles for cite but not for the bibliography", () => {
    const cite = typstBibliographyStyles("0.13.1", "cite");
    expect(cite.find((style) => style.name === "alphanumeric")?.citationOnly).toBe(true);
    expect(cite).toHaveLength(87);
  });

  it("puts project CSL files first", () => {
    setTypstCslStyleProvider(() => ["styles/my-journal.csl", "styles/my-journal.csl", "notes.txt"]);
    const styles = typstBibliographyStyles("0.15.1", "bibliography");
    expect(styles[0]).toEqual({ name: "styles/my-journal.csl", project: true, citationOnly: false });
    expect(styles.filter((style) => style.project)).toHaveLength(1);
  });
});

describe("typstStyleArgumentAt", () => {
  it("finds the style string of bibliography and cite calls and set rules", () => {
    expect(typstStyleArgumentAt('#bibliography("refs.bib", style: "ie')).toEqual({ callee: "bibliography", query: "ie" });
    expect(typstStyleArgumentAt('#bibliography(("a.bib", "b.yml"), title: [Refs (all)], style: "')).toEqual({
      callee: "bibliography",
      query: "",
    });
    expect(typstStyleArgumentAt('#set cite(style: "chicago')).toEqual({ callee: "cite", query: "chicago" });
    expect(typstStyleArgumentAt('#cite(<knuth>, form: "prose", style: "a')).toEqual({ callee: "cite", query: "a" });
    expect(typstStyleArgumentAt('#set bibliography(\n  style: "apa')).toEqual({ callee: "bibliography", query: "apa" });
  });

  it("ignores other arguments, other functions, and closed strings", () => {
    expect(typstStyleArgumentAt('#bibliography("ie')).toBeNull();
    expect(typstStyleArgumentAt('#text(style: "ital')).toBeNull();
    expect(typstStyleArgumentAt('#bibliography("refs.bib", style: "ieee") and "')).toBeNull();
    expect(typstStyleArgumentAt('#bibliography("refs.bib", style: "ieee", title: "')).toBeNull();
    expect(typstStyleArgumentAt("style: \"ieee")).toBeNull();
  });

  it("names a nested call from the identifier before its parenthesis", () => {
    expect(typstStyleArgumentAt('#figure(bibliography ("refs.bib", style: "ie')).toEqual({
      callee: "bibliography",
      query: "ie",
    });
    expect(typstStyleArgumentAt('#figure(x.cite(style: "a')).toEqual({ callee: "cite", query: "a" });
    expect(typstStyleArgumentAt('#figure(mycite(style: "a')).toBeNull();
  });
});

describe("enclosingFrames", () => {
  it("tracks code calls, code blocks and content blocks inside a markup call", () => {
    expect(enclosingFrames("#f(a.b2-c (x, {y, [z")).toEqual([
      { close: ")", code: true, callee: "f" },
      { close: ")", code: true, callee: "b2-c" },
      { close: "}", code: true, callee: "" },
      { close: "]", code: false, callee: "" },
    ]);
  });

  it("starts a callee at its first letter and leaves a parenthesis after an operator unnamed", () => {
    expect(enclosingFrames("#f(9-x_1 (").map((frame) => frame.callee)).toEqual(["f", "x_1"]);
    expect(enclosingFrames("#f(1 + (").map((frame) => frame.callee)).toEqual(["f", ""]);
  });

  it("skips comments, escapes, raw text and hashes that start no call", () => {
    expect(enclosingFrames("// #f(\n/* #g( */ \\#h( `#i(` # j #k(")).toEqual([{ close: ")", code: true, callee: "k" }]);
    expect(enclosingFrames("#f(a) [b] #g(c)")).toEqual([]);
  });
});

describe("typstBibliographyStyleCompletions", () => {
  it("completes style names inside the style string and replaces the typed prefix", () => {
    const doc = '#bibliography("refs.bib", style: "nlm';
    const result = complete(doc);
    expect(result?.from).toBe(doc.length - 3);
    expect(labels(result)).toContain("nlm-citation-sequence");
    expect(labels(result)).not.toContain("alphanumeric");
    const ieee = result?.options.find((option) => option.label === "ieee");
    expect(ieee?.detail).toBe("built-in CSL style");
  });

  it("marks citation-only styles in cite completions", () => {
    const result = complete('#set cite(style: "');
    const alphanumeric = result?.options.find((option) => option.label === "alphanumeric");
    expect(alphanumeric?.detail).toBe("citation style only");
  });

  it("follows the project's Typst version", () => {
    setTypstStyleVersionProvider(() => "0.13.1");
    const result = complete('#bibliography("refs.bib", style: "');
    expect(labels(result)).toContain("vancouver");
    expect(labels(result)).not.toContain("nlm-citation-sequence");
  });

  it("stays quiet outside a style argument", () => {
    expect(complete('#bibliography("re')).toBeNull();
    expect(complete("Some prose with style: \"x")).toBeNull();
  });
});
