import { describe, expect, it } from "vitest";
import { parseBibtexIntelligence } from "./parse-bibtex";

function analyze(source: string) {
  return parseBibtexIntelligence("refs.bib", source, 1);
}

function fieldSummary(source: string) {
  return analyze(source).bibliographyEntries[0]?.fields.map((field) => [
    field.name,
    field.value,
    field.valueStyle,
    field.complete,
  ]);
}

function messages(source: string) {
  return analyze(source).diagnostics.map((diagnostic) => diagnostic.message);
}

describe("parseBibtexIntelligence", () => {
  it("reads braced, quoted and bare field values", () => {
    expect(
      fieldSummary(
        '@article{alpha, title={A {nested} title}, author="Quoted", year = 2025 , journal={J}}',
      ),
    ).toEqual([
      ["title", "A {nested} title", "braced", true],
      ["author", "Quoted", "quoted", true],
      ["year", "2025", "bare", true],
      ["journal", "J", "braced", true],
    ]);
  });

  it("folds whitespace inside a braced value", () => {
    expect(fieldSummary("@misc{m, title={one\n  two}}")).toEqual([
      ["title", "one two", "braced", true],
    ]);
  });

  it("recovers at the next entry when a value never closes", () => {
    const value = analyze('@article{a, title="T\n@misc{b, title={U}}');
    expect(value.bibliographyEntries.map((entry) => entry.key)).toEqual([
      "a",
      "b",
    ]);
    expect(value.status).toBe("partial");
  });

  it("skips comment, string and preamble directives", () => {
    const value = analyze(
      "@comment{ignored}\n@string{x = {y}}\n@preamble{ z }\n@misc{m, title={T}}",
    );
    expect(value.bibliographyEntries.map((entry) => entry.key)).toEqual(["m"]);
    expect(value.status).toBe("success");
  });

  it("reports an unclosed directive", () => {
    expect(messages("@comment{never closed")).toEqual([
      { key: "unclosedDirective", params: { type: "comment" } },
    ]);
  });

  it("reports a missing citation key", () => {
    expect(messages("@article{, title={T}}")).toEqual([
      { key: "missingCitationKey", params: { type: "article" } },
    ]);
  });

  it("reports a field name it cannot parse", () => {
    expect(messages("@misc{k, 9bad={T}}")).toEqual([
      { key: "unparsableFieldNamed", params: { key: "k" } },
    ]);
  });

  it("reports a field with no equals sign", () => {
    expect(messages("@misc{k, title}")).toEqual([
      { key: "fieldMissingEquals", params: { name: "title" } },
    ]);
  });

  it("reports an entry whose key is not followed by a field list", () => {
    expect(messages("@misc{k title={T}}")).toContainEqual({
      key: "entryMissingFieldList",
      params: { key: "k title={T" },
    });
  });

  it("reports every missing required field for a known type", () => {
    expect(messages("@article{a, title={T}}")).toEqual([
      {
        key: "missingRequiredField",
        params: { entry: "@article{a}", fields: "author" },
      },
      {
        key: "missingRequiredField",
        params: { entry: "@article{a}", fields: "journal" },
      },
      {
        key: "missingRequiredField",
        params: { entry: "@article{a}", fields: "year" },
      },
    ]);
  });

  it("accepts either alternative of a required field pair", () => {
    expect(
      messages("@book{b, editor={E}, title={T}, publisher={P}, year={2000}}"),
    ).toEqual([]);
  });

  it("warns about an unknown entry type", () => {
    expect(messages("@nope{k, title={T}}")).toEqual([
      { key: "unknownEntryType", params: { type: "nope" } },
    ]);
  });

  it("reports every occurrence of a repeated field", () => {
    expect(messages("@misc{k, title={T}, title={U}}")).toEqual([
      { key: "fieldRepeated", params: { name: "title", key: "k" } },
      { key: "fieldRepeated", params: { name: "title", key: "k" } },
    ]);
  });

  it("warns about a year that is not four digits", () => {
    expect(messages("@misc{k, year={19x9}}")).toEqual([
      { key: "invalidYear", params: { year: "19x9" } },
    ]);
  });

  it("accepts a year with a disambiguating suffix", () => {
    expect(messages("@misc{k, year={2025a}}")).toEqual([]);
  });

  it("records one citation use per cross-reference key", () => {
    const value = analyze("@misc{m, crossref={one, two}}");
    expect(value.uses.map((use) => use.name)).toEqual(["one", "two"]);
    expect(
      value.uses.map((use) => [use.location.range.from, use.location.range.to]),
    ).toEqual([
      [19, 22],
      [24, 27],
    ]);
  });

  it("leaves a field that is not a cross reference alone", () => {
    expect(analyze("@misc{m, note={one, two}}").uses).toEqual([]);
  });

  it("emits a file definition, an entry definition and an outline node", () => {
    const value = analyze("@misc{m, title={T}}");
    expect(value.definitions.map((definition) => definition.kind)).toEqual([
      "file",
      "bibentry",
    ]);
    expect(value.outline.map((node) => node.title)).toEqual(["m"]);
  });

  it("reports a directive that is not followed by a delimiter", () => {
    expect(messages("@article ")).toEqual([
      { key: "typeDelimiterExpected", params: { type: "article" } },
    ]);
  });

  it("reports an at sign that starts nothing", () => {
    expect(messages("@ ")).toEqual([{ key: "malformedDirective" }]);
  });

  it("parses parenthesised entries", () => {
    expect(fieldSummary("@misc(m, title={T})")).toEqual([
      ["title", "T", "braced", true],
    ]);
  });
});
