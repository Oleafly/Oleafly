import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ listFiles: vi.fn(), readFileContent: vi.fn() }));
vi.mock("@/lib/tauri", () => tauri);

const { citationLabel, projectCitations } = await import("./note-citations");

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
    await expect(projectCitations("paper")).resolves.toEqual([
      { key: "he2022", label: "He 2022, MAE" },
      { key: "knuth", label: "TAOCP" },
      { key: "chen2020", label: "Chen 2020" },
    ]);
    expect(tauri.listFiles).toHaveBeenCalledWith("paper");
    expect(tauri.readFileContent.mock.calls.map((call) => call[1])).toEqual(["refs/main.bib", "extra.BIB"]);
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
    await expect(projectCitations("paper")).resolves.toEqual([{ key: "ok", label: "Fine" }]);
  });
});
