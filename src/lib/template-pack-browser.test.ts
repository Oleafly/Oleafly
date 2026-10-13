import { describe, expect, it } from "vitest";
import type { PackInfo, PackTemplateInfo } from "@/lib/tauri";
import {
  capitalized,
  displayName,
  engineLabel,
  filterTemplates,
  groupPacks,
  sameTemplate,
  templateFacets,
  templateSearchText,
} from "./template-pack-browser";

const pack = (over: Partial<PackInfo>): PackInfo => ({
  id: "p",
  label: "Pack",
  description: "",
  category: "",
  group: "curated",
  approx_bytes: 0,
  count: 1,
  license_summary: "",
  covers: [],
  installed: false,
  installed_count: 0,
  version: 2,
  ...over,
});

const template = (over: Partial<PackTemplateInfo>): PackTemplateInfo => ({
  id: "t",
  name: "Template",
  description: "",
  category: "",
  engine: "pdflatex",
  license: { spdx: "MIT", label: "MIT" },
  credit: null,
  thumb_url: null,
  preview_url: null,
  kind: null,
  languages: [],
  country: null,
  institution: null,
  bytes: 0,
  file_count: 1,
  installed: false,
  ...over,
});

describe("template pack browser helpers", () => {
  it("names engines the way their users know them", () => {
    expect(engineLabel("pdflatex")).toBe("pdfLaTeX");
    expect(engineLabel("XeTeX")).toBe("XeLaTeX");
    expect(engineLabel(" typst ")).toBe("Typst");
    expect(engineLabel("markdown")).toBe("Markdown");
    expect(engineLabel("context")).toBe("context");
    expect(engineLabel("")).toBe("");
  });

  it("groups packs in a fixed order and filters them by label or description", () => {
    const packs = [
      pack({ id: "u", group: "university", label: "Tsinghua" }),
      pack({ id: "c", group: "community", label: "Open letters", description: "Cover letters" }),
      pack({ id: "k", group: "curated", label: "Resumes" }),
      pack({ id: "y", group: "typst", label: "Typst starters" }),
    ];
    expect(groupPacks(packs, "").map((section) => section.group)).toEqual([
      "curated",
      "community",
      "typst",
      "university",
    ]);
    const letters = groupPacks(packs, "  COVER ");
    expect(letters).toHaveLength(1);
    expect(letters[0].packs.map((p) => p.id)).toEqual(["c"]);
    expect(groupPacks(packs, "nothing")).toEqual([]);
  });

  it("filters by engine, kind, language and lowercased search text", () => {
    const templates = [
      template({ id: "a", name: "Tsinghua thesis", engine: "xelatex", kind: "thesis", languages: ["zh"] }),
      template({ id: "b", name: "Letter", engine: "typst", languages: ["en", "de"] }),
      template({ id: "c", name: "Résumé", engine: "pdflatex", institution: "MIT" }),
    ];
    const search = templates.map(templateSearchText);
    const ids = (filter: Partial<Parameters<typeof filterTemplates>[2]>) =>
      filterTemplates(templates, search, { query: "", engine: "", kind: "", language: "", ...filter }).map(
        (t) => t.id,
      );
    expect(filterTemplates(templates, search, { query: "", engine: "", kind: "", language: "" })).toBe(templates);
    expect(ids({ engine: "XeLaTeX" })).toEqual(["a"]);
    expect(ids({ kind: "thesis" })).toEqual(["a"]);
    expect(ids({ language: "de" })).toEqual(["b"]);
    expect(ids({ query: "RÉSUMÉ" })).toEqual(["c"]);
    expect(ids({ query: "mit" })).toEqual(["a", "b", "c"]);
    expect(ids({ query: "letter", engine: "Typst" })).toEqual(["b"]);
    expect(ids({ query: "missing" })).toEqual([]);
  });

  it("collects the facets a pack offers", () => {
    expect(
      templateFacets([
        template({ engine: "typst", kind: "thesis", languages: ["zh", "en"] }),
        template({ engine: "pdflatex", languages: ["en"] }),
        template({ engine: "" }),
      ]),
    ).toEqual({ engines: ["pdfLaTeX", "Typst"], kinds: ["thesis"], languages: ["en", "zh"] });
  });

  it("compares templates field by field", () => {
    const base = template({ languages: ["en"], credit: { url: "https://x", author: null } });
    expect(sameTemplate(base, { ...base })).toBe(true);
    expect(sameTemplate(base, { ...base, installed: true })).toBe(false);
    expect(sameTemplate(base, { ...base, languages: ["de"] })).toBe(false);
    expect(sameTemplate(base, { ...base, credit: null })).toBe(false);
    expect(sameTemplate(base, { ...base, license: { spdx: null, label: "MIT" } })).toBe(false);
  });

  it("shows language and region names and keeps odd codes readable", () => {
    expect(displayName("zh", "language", "en")).toBe("Chinese");
    expect(displayName("CN", "region", "en")).toBe("China");
    expect(displayName("not a code!", "language", "en")).toBe("not a code!");
    expect(capitalized("thesis")).toBe("Thesis");
    expect(capitalized("")).toBe("");
  });
});
