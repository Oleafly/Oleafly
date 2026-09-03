import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedBib } from "@/lib/citation/types";

const mocks = vi.hoisted(() => ({
  readFileContent: vi.fn(),
  writeFileContent: vi.fn(),
  fetchDoiBibtex: vi.fn(),
  fetchArxiv: vi.fn(),
  crossrefSearch: vi.fn(),
  getEditorView: vi.fn(),
  insertAtCursor: vi.fn(),
  rebuildFromDisk: vi.fn(),
  setContent: vi.fn(),
  saveFile: vi.fn(),
}));

type FileEntry = { content: string };

const filesState = {
  projectId: "project-1" as string | null,
  mainDoc: "paper.md",
  activePath: "paper.md" as string | null,
  files: {} as Record<string, FileEntry>,
  tree: [] as Array<{ path: string; is_dir: boolean }>,
  engine: {
    source_extensions: ["md"],
    capabilities: { formatting_profile: "markdown" },
  },
  setContent: mocks.setContent,
  saveFile: mocks.saveFile,
};

vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => filesState },
}));

vi.mock("@/store/settings", () => ({
  useSettingsStore: { getState: () => ({ offline: false }) },
}));

vi.mock("@/store/project-index", () => ({
  useIndexStore: {
    getState: () => ({ index: null, rebuildFromDisk: mocks.rebuildFromDisk }),
  },
}));

vi.mock("@/components/editor/cm/controller", () => ({
  getEditorView: mocks.getEditorView,
  insertAtCursor: mocks.insertAtCursor,
}));

vi.mock("@/lib/tauri", () => ({
  readFileContent: mocks.readFileContent,
  writeFileContent: mocks.writeFileContent,
  fetchDoiBibtex: mocks.fetchDoiBibtex,
  fetchArxiv: mocks.fetchArxiv,
  crossrefSearch: mocks.crossrefSearch,
}));

import {
  addCitation,
  addCitations,
  markdownBibliographyPaths,
  parseCitationFile,
  selectCitationBibliography,
} from "./citation";

const BIBTEX = "@article{placeholder,\n  title = {Edge Sensing},\n  author = {Ada Lovelace},\n  year = {2024}\n}";

function markdown(front: string): string {
  return `---\n${front}\n---\n\nBody\n`;
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.saveFile.mockResolvedValue(undefined);
  mocks.writeFileContent.mockResolvedValue(undefined);
  mocks.rebuildFromDisk.mockResolvedValue(undefined);
  mocks.getEditorView.mockReturnValue({});
  mocks.setContent.mockImplementation((path: string, content: string) => {
    filesState.files[path] = { content };
  });
  filesState.projectId = "project-1";
  filesState.mainDoc = "paper.md";
  filesState.activePath = "paper.md";
  filesState.files = {};
  filesState.tree = [];
  filesState.engine = {
    source_extensions: ["md"],
    capabilities: { formatting_profile: "markdown" },
  };
});

describe("markdownBibliographyPaths", () => {
  it("reads an inline YAML list", () => {
    expect(markdownBibliographyPaths(markdown('bibliography: [a.bib, "refs/b.bib"]'))).toEqual([
      "a.bib",
      "refs/b.bib",
    ]);
  });

  it("drops entries the inline list cannot quote", () => {
    expect(markdownBibliographyPaths(markdown("bibliography: [ , a.bib]"))).toEqual(["a.bib"]);
  });

  it("stops a block list at the next unindented key", () => {
    const source = markdown("bibliography:\n  - first.bib\ntitle: Paper\n  - never.bib");
    expect(markdownBibliographyPaths(source)).toEqual(["first.bib"]);
  });

  it("ignores a double-quoted scalar that is not valid JSON", () => {
    expect(markdownBibliographyPaths(markdown('bibliography: "refs\\qbroken.bib"'))).toEqual([]);
  });

  it("strips a trailing comment from a scalar", () => {
    expect(markdownBibliographyPaths(markdown("bibliography: refs.bib # the library"))).toEqual([
      "refs.bib",
    ]);
  });

  it("returns nothing without front matter or a bibliography key", () => {
    expect(markdownBibliographyPaths("# Paper\n")).toEqual([]);
    expect(markdownBibliographyPaths(markdown("title: Paper"))).toEqual([]);
  });
});

describe("selectCitationBibliography", () => {
  it("follows a LaTeX declaration and supplies the .bib extension", () => {
    expect(
      selectCitationBibliography("latex", "\\bibliography{refs}\n", ["other.bib", "refs.bib"]),
    ).toBe("refs.bib");
    expect(
      selectCitationBibliography("latex", "\\addbibresource{lib/refs.bib}\n", ["lib/refs.bib"]),
    ).toBe("lib/refs.bib");
  });

  it("takes only the first entry of a multi-file LaTeX declaration", () => {
    expect(
      selectCitationBibliography("latex", "\\bibliography{first, second}\n", [
        "second.bib",
        "first.bib",
      ]),
    ).toBe("first.bib");
  });

  it("follows a Typst declaration", () => {
    expect(
      selectCitationBibliography("typst", '#bibliography("lib/refs.bib")\n', ["lib/refs.bib"]),
    ).toBe("lib/refs.bib");
  });

  it("matches a declaration against a unique path suffix", () => {
    expect(
      selectCitationBibliography("typst", '#bibliography("refs.bib")\n', ["chapters/refs.bib"]),
    ).toBe("chapters/refs.bib");
  });

  it("matches a declaration against a unique basename", () => {
    expect(
      selectCitationBibliography("typst", '#bibliography("a/refs.bib")\n', ["deep/refs.bib"]),
    ).toBe("deep/refs.bib");
  });

  it("trusts a declared relative path the project has not created yet", () => {
    expect(selectCitationBibliography("latex", "\\bibliography{planned}\n", [])).toBe(
      "planned.bib",
    );
  });

  it("refuses an absolute or escaping declaration and falls back", () => {
    expect(
      selectCitationBibliography("typst", '#bibliography("/etc/refs.bib")\n', ["safe.bib"]),
    ).toBe("safe.bib");
    expect(
      selectCitationBibliography("typst", '#bibliography("../outside/refs.bib")\n', []),
    ).toBe("references.bib");
  });

  it("falls back to the first bib file, then to a default name", () => {
    expect(selectCitationBibliography("latex", "no declaration\n", ["only.bib"])).toBe("only.bib");
    expect(selectCitationBibliography("latex", "no declaration\n", [])).toBe("references.bib");
  });
});

describe("addCitation", () => {
  it("rejects a citation it cannot parse", async () => {
    expect(await addCitation("not bibtex")).toEqual({ error: "Could not parse the citation." });
  });

  it("writes into the open bib file and declares it in Markdown front matter", async () => {
    filesState.files = {
      "paper.md": { content: "# Paper\n" },
      "refs.bib": { content: "" },
    };
    filesState.tree = [
      { path: "paper.md", is_dir: false },
      { path: "refs.bib", is_dir: false },
    ];

    const result = await addCitation(BIBTEX);

    expect(result).toEqual({ key: "lovelace2024edge" });
    expect(filesState.files["refs.bib"].content).toContain("@article{lovelace2024edge,");
    expect(filesState.files["paper.md"].content).toBe(
      '---\nbibliography: "refs.bib"\n---\n\n# Paper\n',
    );
    expect(mocks.saveFile).toHaveBeenCalledWith("refs.bib");
    expect(mocks.saveFile).toHaveBeenCalledWith("paper.md");
    expect(mocks.insertAtCursor).toHaveBeenCalledWith("[@lovelace2024edge]");
    expect(mocks.rebuildFromDisk).toHaveBeenCalled();
  });

  it("writes a Typst bibliography declaration straight to disk when the main file is closed", async () => {
    filesState.mainDoc = "paper.typ";
    filesState.activePath = "paper.typ";
    filesState.engine = {
      source_extensions: ["typ"],
      capabilities: { formatting_profile: "typst" },
    };
    filesState.files = { "refs.bib": { content: "" } };
    filesState.tree = [{ path: "refs.bib", is_dir: false }];
    mocks.readFileContent.mockResolvedValue("= Paper\n");

    const result = await addCitation(BIBTEX);

    expect(result).toEqual({ key: "lovelace2024edge" });
    expect(mocks.writeFileContent).toHaveBeenCalledWith(
      "project-1",
      "paper.typ",
      '= Paper\n\n#bibliography("refs.bib")\n',
    );
    expect(mocks.insertAtCursor).toHaveBeenCalledWith("@lovelace2024edge");
  });

  it("leaves an already declared Typst bibliography alone", async () => {
    filesState.mainDoc = "paper.typ";
    filesState.activePath = "paper.typ";
    filesState.engine = {
      source_extensions: ["typ"],
      capabilities: { formatting_profile: "typst" },
    };
    filesState.files = {
      "paper.typ": { content: '= Paper\n\n#bibliography("refs.bib")\n' },
      "refs.bib": { content: "" },
    };
    filesState.tree = [{ path: "refs.bib", is_dir: false }];

    await addCitation(BIBTEX);

    expect(mocks.writeFileContent).not.toHaveBeenCalled();
    expect(mocks.saveFile).not.toHaveBeenCalledWith("paper.typ");
  });

  it("reuses the key already recorded for the same DOI", async () => {
    filesState.files = {
      "paper.md": { content: "# Paper\n" },
      "refs.bib": {
        content: "@article{earlier2020work,\n  doi = {10.1000/edge}\n}\n",
      },
    };
    filesState.tree = [{ path: "refs.bib", is_dir: false }];

    const result = await addCitation(
      "@article{fresh,\n  title = {Edge Sensing},\n  doi = {10.1000/edge}\n}",
    );

    expect(result).toEqual({ key: "earlier2020work" });
    expect(mocks.saveFile).not.toHaveBeenCalled();
    expect(mocks.insertAtCursor).toHaveBeenCalledWith("[@earlier2020work]");
  });

  it("reports a bib file it could not write", async () => {
    filesState.files = {
      "paper.md": { content: "# Paper\n" },
      "refs.bib": { content: "" },
    };
    filesState.tree = [{ path: "refs.bib", is_dir: false }];
    mocks.saveFile.mockRejectedValue(new Error("disk full"));

    expect(await addCitation(BIBTEX)).toEqual({
      error: "Could not write refs.bib: Error: disk full",
    });
  });

  it("skips the cite insertion when the active file is not a source file", async () => {
    filesState.activePath = "notes.txt";
    filesState.files = {
      "paper.md": { content: "# Paper\n" },
      "refs.bib": { content: "" },
    };
    filesState.tree = [{ path: "refs.bib", is_dir: false }];

    await addCitation(BIBTEX);

    expect(mocks.insertAtCursor).not.toHaveBeenCalled();
  });
});

describe("addCitations", () => {
  const entries: ParsedBib[] = [
    {
      type: "article",
      key: "a",
      fields: { title: "Edge Sensing", author: "Ada Lovelace", year: "2024", doi: "10.1/one" },
    },
    {
      type: "article",
      key: "b",
      fields: { title: "Edge Sensing", author: "Ada Lovelace", year: "2024", doi: "10.1/ONE" },
    },
    {
      type: "book",
      key: "c",
      fields: { title: "Looms", author: "Grace Hopper", year: "1959" },
    },
  ];

  it("reports nothing to do for an empty batch", async () => {
    expect(await addCitations([])).toEqual({ imported: 0, duplicates: 0, errors: [] });
  });

  it("dedupes by DOI inside the batch and declares the bibliography once", async () => {
    filesState.files = {
      "paper.md": { content: "# Paper\n" },
      "refs.bib": { content: "" },
    };
    filesState.tree = [{ path: "refs.bib", is_dir: false }];

    const result = await addCitations(entries);

    expect(result).toEqual({ imported: 2, duplicates: 1, errors: [] });
    expect(filesState.files["refs.bib"].content).toContain("@article{lovelace2024edge,");
    expect(filesState.files["refs.bib"].content).toContain("@book{hopper1959looms,");
    expect(filesState.files["paper.md"].content).toBe(
      '---\nbibliography: "refs.bib"\n---\n\n# Paper\n',
    );
    expect(mocks.insertAtCursor).not.toHaveBeenCalled();
    expect(mocks.rebuildFromDisk).toHaveBeenCalled();
  });

  it("counts every entry as a duplicate of what the file already holds", async () => {
    filesState.files = {
      "paper.md": { content: "# Paper\n" },
      "refs.bib": { content: "@article{old,\n  doi = {10.1/one}\n}\n" },
    };
    filesState.tree = [{ path: "refs.bib", is_dir: false }];

    expect(await addCitations(entries.slice(0, 2))).toEqual({
      imported: 0,
      duplicates: 2,
      errors: [],
    });
    expect(mocks.saveFile).not.toHaveBeenCalled();
  });

  it("stops before touching the main document when the bib write fails", async () => {
    filesState.files = {
      "paper.md": { content: "# Paper\n" },
      "refs.bib": { content: "" },
    };
    filesState.tree = [{ path: "refs.bib", is_dir: false }];
    mocks.saveFile.mockRejectedValue(new Error("read only"));

    const result = await addCitations(entries);

    expect(result.imported).toBe(2);
    expect(result.errors).toEqual(["Could not write refs.bib: Error: read only"]);
    expect(mocks.saveFile).toHaveBeenCalledTimes(1);
    expect(mocks.rebuildFromDisk).not.toHaveBeenCalled();
  });

  it("creates a closed bib file and main document through the backend", async () => {
    filesState.mainDoc = "paper.typ";
    filesState.activePath = "paper.typ";
    filesState.engine = {
      source_extensions: ["typ"],
      capabilities: { formatting_profile: "typst" },
    };
    filesState.files = {};
    filesState.tree = [];
    mocks.readFileContent.mockResolvedValue("= Paper\n");

    const result = await addCitations([entries[2]]);

    expect(result.imported).toBe(1);
    expect(mocks.writeFileContent).toHaveBeenCalledWith(
      "project-1",
      "references.bib",
      expect.stringContaining("@book{hopper1959looms,"),
    );
    expect(mocks.writeFileContent).toHaveBeenCalledWith(
      "project-1",
      "paper.typ",
      '= Paper\n\n#bibliography("references.bib")\n',
    );
  });
});

describe("parseCitationFile", () => {
  it("routes each extension to its own parser and refuses the rest", () => {
    expect(parseCitationFile("library.bib", BIBTEX)?.[0].fields.title).toBe("Edge Sensing");
    expect(parseCitationFile("library.ris", "TY  - JOUR\nTI  - Edge Sensing\nER  - \n")?.[0]
      .fields.title).toBe("Edge Sensing");
    expect(parseCitationFile("library.txt", "anything")).toBeNull();
    expect(parseCitationFile("library", "anything")).toBeNull();
  });
});
