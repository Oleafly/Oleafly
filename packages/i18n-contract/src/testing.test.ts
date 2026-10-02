import { describe, expect, it } from "vitest";
import {
  catalogEntry,
  catalogTranslator,
  describeMessageCatalog,
  missingCatalogKeys,
  provideTestCatalogs,
  testCatalog,
  testCatalogTranslator,
  undeclaredCatalogKeys,
} from "./testing";

const catalog = {
  save: "Save",
  deleted: "Deleted {{name}} from {{folder}}",
  files_one: "{{count}} file",
  files_other: "{{count}} files",
  group: { nested: "Nested" },
};

const partial = { ...catalog, group: { nested: "Nested", half_one: "only one form" } };

provideTestCatalogs({ sample: catalog });

describeMessageCatalog("sample", ["save", "deleted", "files", "group.nested"]);

describe("catalogEntry", () => {
  it("reads strings at a dotted path and ignores everything else", () => {
    expect(catalogEntry(catalog, "group.nested")).toBe("Nested");
    expect(catalogEntry(catalog, "group")).toBeUndefined();
    expect(catalogEntry(catalog, "save.deeper")).toBeUndefined();
    expect(catalogEntry(null, "save")).toBeUndefined();
  });
});

describe("key coverage", () => {
  it("accepts direct strings and complete plural families", () => {
    expect(missingCatalogKeys(catalog, ["save", "files", "group.nested"])).toEqual([]);
  });

  it("reports keys with no string and incomplete plural families", () => {
    expect(missingCatalogKeys(partial, ["absent", "group.half", "group"])).toEqual([
      "absent",
      "group.half",
      "group",
    ]);
  });

  it("reports catalog entries nobody declared, folding plural suffixes", () => {
    expect(undeclaredCatalogKeys(partial, ["save", "files"])).toEqual([
      "deleted",
      "group.nested",
      "group.half",
    ]);
  });
});

describe("catalogTranslator", () => {
  const t = catalogTranslator<string>(catalog);

  it("fills placeholders and keeps unknown ones", () => {
    expect(t("deleted", { name: "a.tex", folder: "src" })).toBe("Deleted a.tex from src");
    expect(t("deleted", { name: "a.tex" })).toBe("Deleted a.tex from {{folder}}");
    expect(t("save")).toBe("Save");
  });

  it("picks the English plural form from count", () => {
    expect(t("files", { count: 1 })).toBe("1 file");
    expect(t("files", { count: 3 })).toBe("3 files");
    expect(t("save", { count: 2 })).toBe("Save");
  });

  it("falls back to the key when the catalog has no entry", () => {
    expect(t("missing.key")).toBe("missing.key");
  });
});

describe("provided catalogs", () => {
  it("returns registered catalogs and translators", () => {
    expect(testCatalog("sample")).toBe(catalog);
    expect(testCatalogTranslator<string>("sample")("group.nested")).toBe("Nested");
  });

  it("explains how to register a missing catalog", () => {
    expect(() => testCatalog("unknown")).toThrow(/unknown.*Vitest setup/);
  });
});
