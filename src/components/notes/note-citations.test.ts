import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ listFiles: vi.fn(), readFileContent: vi.fn() }));
vi.mock("@/lib/tauri", () => tauri);

const { citationGroups, citationLabel, inlineCitation, projectCitations, referenceLine } = await import("./note-citations");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("citation labels", () => {
  it("names the first author, the year and the title", () => {
    expect(citationLabel("he2022", { author: "He, Kaiming and Chen, Xinlei", year: "2022", title: "{Masked} Autoencoders" })).toBe(
      "He et al. 2022, Masked Autoencoders",
    );
    expect(citationLabel("x", { author: "Ada Lovelace", year: "1843", title: "Notes" })).toBe("Lovelace 1843, Notes");
    expect(citationLabel("x", { author: "{World Health Organization}", date: "2020-01-02" })).toBe("World Health Organization 2020");
    expect(citationLabel("x", { editor: "Smith, J. and Doe, A.", title: "Handbook" })).toBe("Smith et al., Handbook");
    expect(citationLabel("plain", { title: "Only a title" })).toBe("Only a title");
    expect(citationLabel("bare", {})).toBe("bare");
  });
});

describe("a project's references", () => {
  it("reads every BibTeX file in the project, once per key", async () => {
    tauri.listFiles.mockResolvedValue([
      { path: "refs", is_dir: true },
      { path: "refs/main.bib", is_dir: false },
      { path: "extra.BIB", is_dir: false },
      { path: "locked.bib", is_dir: false, unreadable: true },
      { path: "main.tex", is_dir: false },
    ]);
    tauri.readFileContent.mockImplementation(async (_project: string, path: string) =>
      path === "refs/main.bib"
        ? "@article{he2022, author = {He, Kaiming}, year = {2022}, title = {MAE}}\n@book{knuth, title = {TAOCP}}"
        : "@misc{he2022, title = {Duplicate}}\n@misc{chen2020, author = {Chen, Ting}, year = 2020}",
    );
    const found = await projectCitations("paper");
    expect(found.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: "he2022", label: "He 2022, MAE" },
      { key: "knuth", label: "TAOCP" },
      { key: "chen2020", label: "Chen 2020" },
    ]);
    expect(found[0].fields).toMatchObject({ author: "He, Kaiming", year: "2022", title: "MAE" });
    expect(tauri.listFiles).toHaveBeenCalledWith("paper");
    expect(tauri.readFileContent.mock.calls.map((call) => call[1])).toEqual(["refs/main.bib", "extra.BIB"]);
  });

  it("reads Hayagriva YAML files too, skips other YAML and keeps the first entry for a key", async () => {
    const files: Record<string, string> = {
      "refs.bib": "@article{shared, title = {From BibTeX}}",
      "refs.yml": [
        "doe2023:",
        "  type: article",
        "  title: Typst Bibliographies",
        "  author: [Doe, Jane, Roe, Rick]",
        "  date: 2023-05",
        "shared:",
        "  type: misc",
        "  title: From YAML",
        "knuth:",
        "  type: book",
        "  title: The Art of Computer Programming",
        "  author: Knuth, Donald",
        "",
      ].join("\n"),
      "more/extra.YAML": "solo: {type: web, title: Only a title}\n",
      ".github/workflows/ci.yml": "name: CI\non:\n  push:\n    branches: [main]\n",
      "data.yaml": "settings:\n  theme: dark\n",
    };
    tauri.listFiles.mockResolvedValue(Object.keys(files).map((path) => ({ path, is_dir: false })));
    tauri.readFileContent.mockImplementation(async (_project: string, path: string) => files[path] ?? "");
    const found = await projectCitations("typst-paper");
    expect(found.map((citation) => citation.key)).toEqual(["shared", "doe2023", "knuth", "solo"]);
    expect(found.find((citation) => citation.key === "shared")?.label).toBe("From BibTeX");
    expect(found.find((citation) => citation.key === "knuth")?.label).toBe("Knuth, The Art of Computer Programming");
    expect(found.find((citation) => citation.key === "doe2023")?.label).toMatch(/^Doe.* 2023, Typst Bibliographies$/u);
    expect(found.find((citation) => citation.key === "solo")?.label).toBe("Only a title");
  });

  it("skips a file it can't read", async () => {
    tauri.listFiles.mockResolvedValue([
      { path: "a.bib", is_dir: false },
      { path: "b.bib", is_dir: false },
    ]);
    tauri.readFileContent.mockImplementation(async (_project: string, path: string) => {
      if (path === "a.bib") throw new Error("gone");
      return "@misc{ok, title = {Fine}}";
    });
    expect((await projectCitations("paper")).map((citation) => citation.key)).toEqual(["ok"]);
  });
});

describe("citations in a note's text", () => {
  it.each([
    ["[@he2022]", [{ key: "he2022", prefix: "", locator: "" }]],
    ["[@he2022, p. 12]", [{ key: "he2022", prefix: "", locator: "p. 12" }]],
    ["[see @he2022, ch. 2; -@doe:2020]", [{ key: "he2022", prefix: "see", locator: "ch. 2" }, { key: "doe:2020", prefix: "", locator: "" }]],
  ])("reads %s", (text, items) => {
    expect(citationGroups(`Masks ${text}.`)).toEqual([{ from: 6, to: 6 + text.length, items }]);
  });

  it("leaves links, footnotes and e-mail addresses alone", () => {
    expect(citationGroups("[a link](https://x.org) [^1] ann@example.org [[Note]]")).toEqual([]);
  });

  it("writes a group by author and year, and an entry as a reference line", () => {
    const he = { key: "he2022", label: "He 2022, MAE", fields: { author: "He, Kaiming and Chen, Xinlei", year: "2022", title: "{MAE}", journal: "CVPR", doi: "10.1/mae" } };
    const entries = new Map([["he2022", he]]);
    expect(inlineCitation(citationGroups("[see @he2022, p. 3; @gone]")[0], entries)).toBe("(see He et al. 2022, p. 3; gone)");
    expect(referenceLine(he)).toBe("He, Kaiming, Chen, Xinlei (2022). MAE. CVPR. https://doi.org/10.1/mae");
    expect(referenceLine({ key: "bare", label: "Bare entry" })).toBe("Bare entry");
  });
});
