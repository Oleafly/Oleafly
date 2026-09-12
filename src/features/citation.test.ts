import enCore from "@/i18n/locales/en/core.json" with { type: "json" };
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
  writeProjectFile: vi.fn(),
  refreshTree: vi.fn(),
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
  writeProjectFile: mocks.writeProjectFile,
  refreshTree: mocks.refreshTree,
};

vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => ({ ...filesState }) },
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
import { resolveBibliographyPath } from "@oleafly/latex";

const BIBTEX = "@article{placeholder,\n  title = {Edge Sensing},\n  author = {Ada Lovelace},\n  year = {2024}\n}";

function markdown(front: string): string {
  return `---\n${front}\n---\n\nBody\n`;
}

let nextGeneration = 0;
let rememberedGeneration = 0;
let pendingTreePaths: string[] = [];
let refreshCompletions = 0;
let treePathsAtRebuild: string[] = [];
let refreshStateAtRebuild = { started: 0, completed: 0 };

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  nextGeneration = 9;
  rememberedGeneration = 3;
  pendingTreePaths = [];
  refreshCompletions = 0;
  treePathsAtRebuild = [];
  refreshStateAtRebuild = { started: 0, completed: 0 };
  mocks.saveFile.mockResolvedValue(undefined);
  mocks.writeFileContent.mockImplementation(async (_id: string, path: string) => ({
    path,
    generation: nextGeneration++,
  }));
  mocks.refreshTree.mockImplementation(async () => {
    for (const path of pendingTreePaths.splice(0)) {
      if (!filesState.tree.some((entry) => entry.path === path)) {
        filesState.tree = [...filesState.tree, { path, is_dir: false }];
      }
    }
    refreshCompletions++;
  });
  mocks.writeProjectFile.mockImplementation(
    async (id: string, path: string, content: string) => {
      const result = await mocks.writeFileContent(
        id,
        path,
        content,
        rememberedGeneration,
      );
      if (Number.isSafeInteger(result?.generation)) {
        rememberedGeneration = result.generation;
      }
      pendingTreePaths.push(path);
      await mocks.refreshTree();
    },
  );
  mocks.rebuildFromDisk.mockImplementation(async () => {
    treePathsAtRebuild = filesState.tree.map((entry) => entry.path);
    refreshStateAtRebuild = {
      started: mocks.refreshTree.mock.calls.length,
      completed: refreshCompletions,
    };
  });
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

  it("trims a block list item and keeps its inner spacing", () => {
    const source = markdown(
      "bibliography:\n  -   refs/my library.bib   \n  -\t'quoted one.bib'\t\n  -   \n  - last.bib",
    );
    expect(markdownBibliographyPaths(source)).toEqual([
      "refs/my library.bib",
      "quoted one.bib",
      "last.bib",
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

  it("follows a declaration that carries an options bracket", () => {
    expect(
      selectCitationBibliography(
        "latex",
        "\\addbibresource[location=local]{refs.bib}\n",
        ["other.bib", "refs.bib"],
        "main.tex",
      ),
    ).toBe("refs.bib");
    expect(
      selectCitationBibliography("latex", "\\bibliography*{refs}\n", ["other.bib", "refs.bib"], "main.tex"),
    ).toBe("refs.bib");
  });

  it("resolves a declaration the same way the preflight resolver does", () => {
    expect(
      selectCitationBibliography(
        "latex",
        "\\addbibresource[location=local]{refs.bib}\n",
        ["other.bib", "refs.bib"],
        "main.tex",
      ),
    ).toBe(
      resolveBibliographyPath("refs.bib", "main.tex", ["other.bib", "refs.bib"], "biblatex"),
    );
  });

  it("prefers the bib file next to the declaring document over a root-level namesake", () => {
    expect(
      selectCitationBibliography("latex", "\\bibliography{refs}\n", ["paper/refs.bib"], "paper/main.tex"),
    ).toBe("paper/refs.bib");
  });

  it("ignores a commented-out declaration", () => {
    expect(
      selectCitationBibliography("latex", "% \\bibliography{refs}\n", ["other.bib", "refs.bib"], "main.tex"),
    ).toBe("other.bib");
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
    expect(await addCitation("not bibtex")).toEqual({ error: enCore.citation.parseFailed });
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
    expect(mocks.writeProjectFile).toHaveBeenCalledWith(
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

    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
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
      error: enCore.citation.writeFailed
        .replace("{{path}}", "refs.bib")
        .replace("{{detail}}", "Error: disk full"),
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

    expect(result).toEqual({ imported: 2, duplicates: 1, errors: [], bibPath: "refs.bib" });
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
      bibPath: "refs.bib",
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
    expect(result.errors).toEqual([
      enCore.citation.writeFailed
        .replace("{{path}}", "refs.bib")
        .replace("{{detail}}", "Error: read only"),
    ]);
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
    expect(mocks.writeProjectFile).toHaveBeenCalledWith(
      "project-1",
      "references.bib",
      expect.stringContaining("@book{hopper1959looms,"),
    );
    expect(mocks.writeProjectFile).toHaveBeenCalledWith(
      "project-1",
      "paper.typ",
      '= Paper\n\n#bibliography("references.bib")\n',
    );
    expect(result.bibPath).toBe("references.bib");
    expect(treePathsAtRebuild).toContain("references.bib");
    expect(treePathsAtRebuild).toContain("paper.typ");
    expect(refreshStateAtRebuild.started).toBe(2);
    expect(refreshStateAtRebuild.completed).toBe(2);
  });

  it("waits for the index rebuild before it reports the import", async () => {
    let releaseRebuild!: () => void;
    let rebuilt = false;
    mocks.rebuildFromDisk.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseRebuild = () => {
            rebuilt = true;
            resolve();
          };
        }),
    );
    filesState.files = { "paper.md": { content: "# Paper\n" } };
    mocks.readFileContent.mockResolvedValue("");

    const importing = addCitations([entries[0]]);
    await vi.waitFor(() => expect(mocks.rebuildFromDisk).toHaveBeenCalled());
    let settled = false;
    void importing.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(rebuilt).toBe(false);
    releaseRebuild();

    const result = await importing;
    expect(result.imported).toBe(1);
    expect(rebuilt).toBe(true);
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

describe("citation read failures", () => {
  const entry: ParsedBib = { type: "article", key: "new", fields: { title: "New reference" } };

  for (const batch of [false, true]) {
    for (const path of ["refs.bib", "paper.md"]) {
      it(`preserves unreadable ${path} during ${batch ? "bulk" : "single"} import`, async () => {
        filesState.tree = [{ path: "refs.bib", is_dir: false }];
        filesState.files = path === "refs.bib"
          ? { "paper.md": { content: "# Existing paper\n" } }
          : { "refs.bib": { content: "@book{old,title={Original}}\n" } };
        mocks.readFileContent.mockRejectedValue(new Error("unsupported text encoding"));
        const result = batch ? await addCitations([entry]) : await addCitation(BIBTEX);
        expect(JSON.stringify(result)).toContain(`Could not read ${path}`);
        expect(mocks.writeProjectFile).not.toHaveBeenCalled();
        expect(mocks.setContent).not.toHaveBeenCalled();
        expect(mocks.saveFile).not.toHaveBeenCalled();
        expect(mocks.insertAtCursor).not.toHaveBeenCalled();
      });
    }
  }

  it("allows an absent bibliography without masking other read errors", async () => {
    filesState.files = { "paper.md": { content: "# Paper\n" } };
    mocks.readFileContent.mockResolvedValue("");
    expect(await addCitation(BIBTEX)).toEqual({ key: "lovelace2024edge" });
    expect(mocks.readFileContent).toHaveBeenCalledWith("project-1", "references.bib", true);
    expect(mocks.writeProjectFile).toHaveBeenCalledWith("project-1", "references.bib", expect.stringContaining("Edge Sensing"));
  });
});

it("abandons citation import if the project changes during a main-document read", async () => {
  let finish!: (content: string) => void;
  filesState.files = { "refs.bib": { content: "@book{old,title={Original}}" } };
  filesState.tree = [{ path: "refs.bib", is_dir: false }];
  mocks.readFileContent.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
  const adding = addCitation(BIBTEX);
  filesState.projectId = "project-2";
  filesState.files = { "other.bib": { content: "@book{keep,title={Second project}}" } };
  filesState.tree = [{ path: "other.bib", is_dir: false }];
  finish("# First project\n");
  expect(await adding).toHaveProperty("error", expect.stringContaining("project changed"));
  expect(mocks.writeProjectFile).not.toHaveBeenCalled();
  expect(mocks.saveFile).not.toHaveBeenCalled();
  expect(mocks.setContent).not.toHaveBeenCalled();
  expect(mocks.insertAtCursor).not.toHaveBeenCalled();
});

it("does not edit another project's main document when a bibliography save finishes late", async () => {
  let finish!: () => void;
  let entered!: () => void;
  const saving = new Promise<void>((resolve) => { entered = resolve; });
  filesState.files = { "paper.md": { content: "# First\n" }, "refs.bib": { content: "" } };
  filesState.tree = [{ path: "refs.bib", is_dir: false }];
  mocks.saveFile.mockImplementation(() => { entered(); return new Promise<void>((resolve) => { finish = resolve; }); });
  const adding = addCitation(BIBTEX);
  await saving;
  filesState.projectId = "project-2";
  filesState.files = { "paper.md": { content: "# Second\n" } };
  finish();
  expect(await adding).toHaveProperty("error", expect.stringContaining("project changed"));
  expect(filesState.files["paper.md"].content).toBe("# Second\n");
  expect(mocks.saveFile).toHaveBeenCalledTimes(1);
  expect(mocks.insertAtCursor).not.toHaveBeenCalled();
});

it("checks the project again when preflight resolves immediately before a queued switch", async () => {
  filesState.files = { "paper.md": { content: "# First\n" }, "refs.bib": { content: "@book{a,title={First}}" } };
  filesState.tree = [{ path: "refs.bib", is_dir: false }];
  const adding = addCitation(BIBTEX);
  queueMicrotask(() => queueMicrotask(() => {
    filesState.projectId = "project-2";
    filesState.files = { "refs.bib": { content: "@book{b,title={Second}}" } };
  }));
  expect(await adding).toHaveProperty("error", expect.stringContaining("project changed"));
  expect(filesState.files["refs.bib"].content).toBe("@book{b,title={Second}}");
  expect(mocks.setContent).not.toHaveBeenCalled();
  expect(mocks.saveFile).not.toHaveBeenCalled();
});

it("preserves main-document edits made while the bibliography is saving", async () => {
  filesState.files = { "paper.md": { content: "# First\n" }, "refs.bib": { content: "" } };
  filesState.tree = [{ path: "refs.bib", is_dir: false }];
  mocks.saveFile.mockImplementation(async (path: string) => {
    if (path === "refs.bib") filesState.files = { ...filesState.files, "paper.md": { content: "# Revised\n" } };
  });
  expect(await addCitation(BIBTEX)).toHaveProperty("key");
  expect(filesState.files["paper.md"].content).toContain("# Revised\n");
});
