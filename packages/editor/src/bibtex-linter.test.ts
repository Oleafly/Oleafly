import { describe, expect, it } from "vitest";
import { lintBibtexText, scanBibtexEntries } from "./bibtex-linter";
import { installEnglishEditorMessages } from "./test-messages";

installEnglishEditorMessages();

const COMPLETE_ARTICLE = [
  "@article{knuth84,",
  "  author = {Knuth, Donald},",
  "  title = {Literate Programming},",
  "  journal = {The Computer Journal},",
  "  year = {1984},",
  "}",
].join("\n");

describe("lintBibtexText: required fields", () => {
  it("accepts a complete entry", () => {
    expect(lintBibtexText(COMPLETE_ARTICLE)).toEqual([]);
  });

  it("names the field an entry is missing", () => {
    const found = lintBibtexText(
      "@article{a,\n  author = {A},\n  title = {T},\n  journal = {J},\n}",
    );
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("error");
    expect(found[0].message).toContain("@article{a}");
    expect(found[0].message).toContain("year or date");
    expect(found[0].source).toBe("BibTeX");
  });

  it("marks the entry key, not the whole entry", () => {
    const source = "@article{a,\n  title = {T},\n}";
    const found = lintBibtexText(source);
    expect(found[0].from).toBe(source.indexOf("a,"));
    expect(found[0].to).toBe(source.indexOf("a,") + 1);
  });

  it("accepts the biblatex spelling of an alternative", () => {
    expect(
      lintBibtexText(
        "@article{a,\n  author = {A},\n  title = {T},\n  journaltitle = {J},\n  date = {2026-01-01},\n}",
      ),
    ).toEqual([]);
  });

  it("requires nothing of @misc", () => {
    expect(lintBibtexText("@misc{m,\n  note = {n},\n}")).toEqual([]);
  });

  it("says nothing about an entry that is still being typed", () => {
    expect(lintBibtexText("@article{a,\n  author = {A},")).toEqual([]);
  });

  it("ignores @string, @preamble and @comment", () => {
    expect(
      lintBibtexText(
        '@string{cj = "The Computer Journal"}\n@preamble{ "\\newcommand{\\x}{y}" }\n@comment{anything at all}',
      ),
    ).toEqual([]);
  });
});

describe("lintBibtexText: other checks", () => {
  it("warns about an unknown entry type and checks nothing else", () => {
    const found = lintBibtexText("@nope{k,\n  title = {T},\n}");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("warning");
    expect(found[0].message).toContain("@nope");
  });

  it("warns once about a repeated field", () => {
    const found = lintBibtexText(
      "@misc{m,\n  title = {T},\n  title = {U},\n}",
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("title");
    expect(found[0].message).toContain("m");
  });

  it("warns about a year that is not four digits", () => {
    const found = lintBibtexText("@misc{m,\n  year = {19x9},\n}");
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain("19x9");
  });

  it("accepts a year with a disambiguating suffix and a bare year", () => {
    expect(lintBibtexText("@misc{m,\n  year = {2026a},\n}")).toEqual([]);
    expect(lintBibtexText("@misc{m,\n  year = 2026,\n}")).toEqual([]);
  });

  it("reads quoted and parenthesised entries", () => {
    expect(
      lintBibtexText(
        '@article(a,\n  author = "A",\n  title = "T",\n  journal = "J",\n  year = "1999"\n)',
      ),
    ).toEqual([]);
  });

  it("keeps checking after a damaged entry", () => {
    const source = `@article{broken,\n  title = {T},\n${COMPLETE_ARTICLE}\n@article{second,\n  title = {T},\n}`;
    const messages = lintBibtexText(source).map(
      (found) => found.message,
    );
    expect(messages.some((text) => text.includes("@article{second}"))).toBe(
      true,
    );
  });

  it("does not confuse a brace inside a value for the end of an entry", () => {
    expect(
      lintBibtexText(
        "@misc{m,\n  title = {A {Nested} Title},\n  note = {n},\n}",
      ),
    ).toEqual([]);
    expect(scanBibtexEntries("@misc{m,\n  title = {A {B} C},\n}")).toHaveLength(
      1,
    );
  });
});

describe("lintBibtexText: %%novalidate", () => {
  const BROKEN = "@article{a,\n  title = {T},\n}";

  it("reports the file without the escape hatch", () => {
    expect(lintBibtexText(BROKEN).length).toBeGreaterThan(0);
  });

  it("disables the whole file", () => {
    expect(lintBibtexText(`%%novalidate\n${BROKEN}`)).toEqual([]);
    expect(lintBibtexText(`${BROKEN}\n%%novalidate\n`)).toEqual([]);
    expect(lintBibtexText(`  %% novalidate  \n${BROKEN}`)).toEqual([]);
  });

  it("disables only the region between the markers", () => {
    const source = [
      "%%begin novalidate",
      BROKEN,
      "%%end novalidate",
      "@article{b,",
      "  title = {T},",
      "}",
    ].join("\n");
    const found = lintBibtexText(source);
    expect(found.every((item) => item.message.includes("@article{b}"))).toBe(
      true,
    );
    expect(found.length).toBeGreaterThan(0);
  });

  it("runs to the end of the file when a region is never closed", () => {
    expect(
      lintBibtexText(`%%begin novalidate\n${BROKEN}\n@article{b,\n  title = {T},\n}`),
    ).toEqual([]);
  });

  it("leaves an ordinary comment alone", () => {
    expect(lintBibtexText(`%% novalidate entries below\n${BROKEN}`).length)
      .toBeGreaterThan(0);
  });
});
