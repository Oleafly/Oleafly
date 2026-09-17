import { describe, expect, it } from "vitest";
import {
  BIBTEX_DIRECTIVES,
  BIBTEX_ENTRY_TYPES,
  bibtexEntryFields,
  bibtexEntryType,
  isBibtexDirective,
  missingBibtexRequiredFields,
} from "./bibtex-entry-types";

const names = BIBTEX_ENTRY_TYPES.map((type) => type.name);

describe("bibtex entry types", () => {
  it("covers the standard BibTeX types", () => {
    for (const name of [
      "article",
      "book",
      "booklet",
      "conference",
      "inbook",
      "incollection",
      "inproceedings",
      "manual",
      "mastersthesis",
      "misc",
      "phdthesis",
      "proceedings",
      "techreport",
      "unpublished",
    ]) {
      expect(names, name).toContain(name);
    }
  });

  it("covers the common biblatex types", () => {
    for (const name of [
      "online",
      "electronic",
      "www",
      "software",
      "dataset",
      "patent",
      "thesis",
      "report",
      "collection",
      "mvbook",
      "inreference",
      "reference",
      "periodical",
      "suppbook",
      "bookinbook",
    ]) {
      expect(names, name).toContain(name);
    }
  });

  it("lists every type exactly once, in name order", () => {
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort((a, b) => Number(a > b) - Number(a < b))).toEqual(
      names,
    );
  });

  it("resolves a type case insensitively and rejects an unknown one", () => {
    expect(bibtexEntryType("ARTICLE")?.name).toBe("article");
    expect(bibtexEntryType("nope")).toBeNull();
  });

  it("gives aliases the same fields as the type they stand for", () => {
    expect(bibtexEntryType("conference")?.required).toEqual(
      bibtexEntryType("inproceedings")?.required,
    );
    expect(bibtexEntryType("www")?.optional).toEqual(
      bibtexEntryType("online")?.optional,
    );
  });

  it("expresses required fields as alternatives", () => {
    expect(bibtexEntryType("book")?.required).toContainEqual([
      "author",
      "editor",
    ]);
    expect(bibtexEntryType("article")?.required).toContainEqual([
      "journal",
      "journaltitle",
    ]);
    expect(bibtexEntryType("phdthesis")?.required).toContainEqual([
      "school",
      "institution",
    ]);
    for (const type of BIBTEX_ENTRY_TYPES) {
      for (const group of type.required) {
        expect(group.length, type.name).toBeGreaterThan(0);
      }
    }
  });

  it("never repeats a required field in the optional list", () => {
    for (const type of BIBTEX_ENTRY_TYPES) {
      const required = new Set(type.required.flat());
      expect(
        type.optional.filter((field) => required.has(field)),
        type.name,
      ).toEqual([]);
      expect(new Set(type.optional).size, type.name).toBe(
        type.optional.length,
      );
    }
  });

  it("requires nothing for misc", () => {
    expect(bibtexEntryType("misc")?.required).toEqual([]);
    expect(missingBibtexRequiredFields("misc", new Set())).toEqual([]);
  });

  it("reports the required groups an entry does not satisfy", () => {
    expect(
      missingBibtexRequiredFields("article", new Set(["title"])),
    ).toEqual([["author"], ["journal", "journaltitle"], ["year", "date"]]);
  });

  it("accepts either alternative and the biblatex spelling", () => {
    expect(
      missingBibtexRequiredFields(
        "book",
        new Set(["editor", "title", "publisher", "date"]),
      ),
    ).toEqual([]);
  });

  it("reports nothing for an unknown type", () => {
    expect(missingBibtexRequiredFields("nope", new Set())).toEqual([]);
  });

  it("offers required fields before optional ones for completion", () => {
    const fields = bibtexEntryFields("article");
    expect(fields.slice(0, 6)).toEqual([
      "author",
      "title",
      "journal",
      "journaltitle",
      "year",
      "date",
    ]);
    expect(fields).toContain("volume");
    expect(bibtexEntryFields("nope")).toEqual([]);
  });

  it("knows the three BibTeX directives", () => {
    expect(BIBTEX_DIRECTIVES).toEqual(["comment", "preamble", "string"]);
    expect(isBibtexDirective("String")).toBe(true);
    expect(isBibtexDirective("article")).toBe(false);
  });
});
