import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ZoteroExportedEntry, ZoteroHit, ZoteroProjectLink } from "@oleafly/backend-port";

const mocks = vi.hoisted(() => ({
  exportEntries: vi.fn(),
  links: vi.fn(),
  updateLinks: vi.fn(),
  lookup: vi.fn(),
  items: vi.fn(),
  readFileContent: vi.fn(),
  setContent: vi.fn(),
  saveFile: vi.fn(),
  writeProjectFile: vi.fn(),
  updateFile: vi.fn(),
  rebuildFromDisk: vi.fn(),
  remembered: new Map<string, string>(),
}));

type FileState = { content: string; dirty: boolean };

const files = {
  projectId: "p1" as string | null,
  mainDoc: "main.tex",
  activePath: "main.tex" as string | null,
  files: {} as Record<string, FileState>,
  tree: [] as Array<{ path: string; is_dir: boolean; read_only?: boolean }>,
  engine: {
    source_extensions: ["tex"],
    capabilities: { formatting_profile: "latex" },
  },
  setContent: mocks.setContent,
  saveFile: mocks.saveFile,
  writeProjectFile: mocks.writeProjectFile,
};

const index = {
  texts: {} as Record<string, string>,
  intelligenceState: { data: null as unknown },
  updateFile: mocks.updateFile,
  rebuildFromDisk: mocks.rebuildFromDisk,
};

vi.mock("@/store/files", () => ({ useFilesStore: { getState: () => files } }));
vi.mock("@/store/project-index", () => ({ useIndexStore: { getState: () => index } }));
vi.mock("@/store/settings", () => ({ useSettingsStore: { getState: () => ({ offline: false }) } }));
vi.mock("@/store/folder-access", () => ({
  projectFolderIsReadOnly: () => false,
  readOnlyFolderMessage: () => "read only",
}));
vi.mock("@/lib/tex-root", () => ({ resolveEffectiveMainDoc: () => ({ mainDoc: files.mainDoc }) }));
vi.mock("@/lib/citation/bibliography-choices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/citation/bibliography-choices")>()),
  rememberedBibliography: (projectId: string) => mocks.remembered.get(projectId) ?? null,
  rememberBibliography: (projectId: string, path: string) => mocks.remembered.set(projectId, path),
}));
vi.mock("@/lib/tauri", () => ({
  zoteroLibraryExport: mocks.exportEntries,
  zoteroProjectLinks: mocks.links,
  zoteroUpdateProjectLinks: mocks.updateLinks,
  zoteroLibraryLookup: mocks.lookup,
  zoteroLibraryItems: mocks.items,
  readFileContent: mocks.readFileContent,
}));

import { entryHash } from "@/lib/zotero/bib-text";
import {
  citationKeyForHit,
  ensureZoteroEntries,
  findMissingInZotero,
  loadProjectLinks,
  projectBibliography,
  requestZoteroUpdate,
  resetZoteroCiteForTest,
  staleZoteroEntries,
} from "./zotero-cite";

function hit(overrides: Partial<ZoteroHit> = {}): ZoteroHit {
  return {
    library: "user",
    itemKey: "SMITH234",
    citationKey: "smithBBT2020",
    keySource: "bbt",
    title: "Deep learning",
    authors: ["Smith"],
    authorCount: 1,
    year: "2020",
    doi: "10.1/smith",
    itemType: "journalArticle",
    dateModified: "2024-01-01T00:00:00Z",
    score: 1,
    ...overrides,
  };
}

function exported(key: string, overrides: Partial<ZoteroExportedEntry> = {}): ZoteroExportedEntry {
  return {
    library: "user",
    itemKey: "SMITH234",
    citationKey: key,
    keySource: "bbt",
    entry: `@article{${key},\n  title = {Deep learning},\n  doi = {10.1/smith}\n}`,
    origin: "betterBibtex",
    dateModified: "2024-01-01T00:00:00Z",
    version: 3,
    doi: "10.1/smith",
    ...overrides,
  };
}

function project(sources: Record<string, string>, open: string[] = [], profile = "latex", main = "main.tex") {
  files.files = Object.fromEntries(
    Object.entries(sources)
      .filter(([path]) => open.includes(path))
      .map(([path, content]) => [path, { content, dirty: false }]),
  );
  files.tree = Object.keys(sources).map((path) => ({ path, is_dir: false }));
  files.mainDoc = main;
  files.activePath = main;
  files.engine = {
    source_extensions: [main.split(".").pop() ?? "tex"],
    capabilities: { formatting_profile: profile },
  };
  index.texts = { ...sources };
}

let disk: Record<string, string> = {};
let storedLinks: Record<string, ZoteroProjectLink> = {};

beforeEach(() => {
  for (const mock of Object.values(mocks)) if (typeof mock === "function") mock.mockReset();
  mocks.remembered.clear();
  resetZoteroCiteForTest();
  files.projectId = "p1";
  index.intelligenceState = { data: null };
  disk = {};
  storedLinks = {};
  mocks.setContent.mockImplementation((path: string, content: string) => {
    files.files[path] = { content, dirty: true };
    return true;
  });
  mocks.saveFile.mockImplementation(async (path: string) => {
    disk[path] = files.files[path].content;
  });
  mocks.writeProjectFile.mockImplementation(async (_id: string, path: string, content: string) => {
    disk[path] = content;
  });
  mocks.readFileContent.mockImplementation(async (_id: string, path: string) => disk[path] ?? "");
  mocks.links.mockImplementation(async () => ({ ...storedLinks }));
  mocks.updateLinks.mockImplementation(async (_id: string, changes: Record<string, ZoteroProjectLink | null>) => {
    for (const [key, link] of Object.entries(changes)) {
      if (link) storedLinks[key] = link;
      else delete storedLinks[key];
    }
    return { ...storedLinks };
  });
  mocks.exportEntries.mockImplementation(async (refs: { itemKey: string }[]) =>
    refs.map(() => exported("smithBBT2020")),
  );
});

const PLAIN = "\\documentclass{article}\n\\begin{document}\nSee \\cite{smithBBT2020}.\n\\end{document}\n";

describe("adding a Zotero item to the project", () => {
  it("creates references.bib and the bibliography line when the project has neither", async () => {
    project({ "main.tex": PLAIN }, ["main.tex"]);
    const result = await ensureZoteroEntries([{ hit: hit(), key: "smithBBT2020" }]);
    expect(result).toMatchObject({ added: ["smithBBT2020"], reused: [], bibPath: "references.bib" });
    expect(mocks.exportEntries).toHaveBeenCalledWith([{ library: "user", itemKey: "SMITH234" }], "bibtex", false);
    expect(disk["references.bib"]).toBe("@article{smithBBT2020,\n  title = {Deep learning},\n  doi = {10.1/smith}\n}\n");
    expect(files.files["main.tex"].content).toContain("\\bibliographystyle{plain}\n\\bibliography{references}\n\\end{document}");
    expect(mocks.updateFile).toHaveBeenCalledWith("main.tex", expect.stringContaining("\\bibliography{references}"));
    expect(storedLinks.smithBBT2020).toMatchObject({
      library: "user",
      itemKey: "SMITH234",
      bib: "references.bib",
      hash: entryHash(disk["references.bib"]),
    });
  });

  it("appends to the declared biblatex file in place and asks Zotero for biblatex", async () => {
    const main = PLAIN.replace("\\begin{document}", "\\usepackage{biblatex}\n\\addbibresource{refs.bib}\n\\begin{document}");
    const bib = "% keep this comment\n@book{doe2019,\n  title = {Kept}\n}\n";
    project({ "main.tex": main, "refs.bib": bib }, ["main.tex", "refs.bib"]);
    await ensureZoteroEntries([{ hit: hit(), key: "smithBBT2020" }]);
    expect(mocks.exportEntries).toHaveBeenCalledWith(expect.anything(), "biblatex", false);
    expect(mocks.setContent).toHaveBeenCalledWith("refs.bib", `${bib}\n${exported("smithBBT2020").entry}\n`, expect.anything());
    expect(mocks.saveFile).toHaveBeenCalledWith("refs.bib");
    expect(files.files["main.tex"].content).toBe(main);
    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
  });

  it("never adds a key that is already in the .bib", async () => {
    project({ "main.tex": PLAIN.replace("\\end{document}", "\\bibliography{refs}\n\\end{document}"), "refs.bib": "@article{smithBBT2020,\n title={Mine}\n}\n" }, ["main.tex"]);
    const result = await ensureZoteroEntries([{ hit: hit(), key: "smithBBT2020" }]);
    expect(result).toMatchObject({ added: [], reused: ["smithBBT2020"] });
    expect(mocks.exportEntries).not.toHaveBeenCalled();
    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
    expect(storedLinks.smithBBT2020).toMatchObject({ itemKey: "SMITH234", hash: "" });
  });

  it("never adds the same paper twice under another key", async () => {
    project({ "main.tex": PLAIN.replace("\\end{document}", "\\bibliography{refs}\n\\end{document}"), "refs.bib": "@article{smith2020old,\n doi = {https://doi.org/10.1/SMITH}\n}\n" }, ["main.tex"]);
    expect(citationKeyForHit(hit())).toBe("smith2020old");
    const result = await ensureZoteroEntries([{ hit: hit(), key: "smith2020old" }]);
    expect(result).toMatchObject({ added: [], reused: ["smith2020old"] });
    expect(mocks.exportEntries).not.toHaveBeenCalled();
  });

  it("keeps a generated key clear of keys other papers already use", async () => {
    project({ "refs.bib": "@book{diestel2001graph,\n title={Another}\n}\n", "main.tex": PLAIN }, []);
    storedLinks = { diestel2001graph: { library: "user", itemKey: "OTHER234", dateModified: "", version: 1, hash: "", bib: "refs.bib" } };
    await loadProjectLinks("p1");
    const generated = hit({ itemKey: "GEN23456", citationKey: "diestel2001graph", keySource: "generated", doi: undefined });
    expect(citationKeyForHit(generated)).toBe("diestel2001grapha");
    expect(projectBibliography().keys.has("diestel2001graph")).toBe(true);
  });

  it("reuses the key already cited when Better BibTeX renamed the item", async () => {
    project({ "refs.bib": "@article{smithOld2020,\n title={Deep}\n}\n", "main.tex": PLAIN }, []);
    storedLinks = { smithOld2020: { library: "user", itemKey: "SMITH234", dateModified: "", version: 1, hash: "x", bib: "refs.bib" } };
    await loadProjectLinks("p1");
    expect(citationKeyForHit(hit({ citationKey: "smithNew2020", doi: undefined }))).toBe("smithOld2020");
    expect(citationKeyForHit(hit({ citationKey: "smithNew2020", doi: undefined, aliases: ["smithOld2020"] }))).toBe("smithOld2020");
  });

  it("adds #bibliography to a Typst document", async () => {
    project({ "main.typ": "= Intro\nSee @smithBBT2020.\n" }, ["main.typ"], "typst", "main.typ");
    await ensureZoteroEntries([{ hit: hit(), key: "smithBBT2020" }]);
    expect(mocks.exportEntries).toHaveBeenCalledWith(expect.anything(), "biblatex", false);
    expect(files.files["main.typ"].content).toBe('= Intro\nSee @smithBBT2020.\n\n#bibliography("references.bib")\n');
  });

  it("adds bibliography to Markdown front matter", async () => {
    project({ "paper.md": "---\ntitle: Paper\n---\n\nSee [@smithBBT2020].\n" }, ["paper.md"], "markdown", "paper.md");
    await ensureZoteroEntries([{ hit: hit(), key: "smithBBT2020" }]);
    expect(files.files["paper.md"].content).toBe('---\ntitle: Paper\nbibliography: "references.bib"\n---\n\nSee [@smithBBT2020].\n');
    expect(disk["references.bib"]).toContain("@article{smithBBT2020,");
  });

  it("asks once which bibliography receives entries when there are several", async () => {
    const main = PLAIN.replace("\\end{document}", "\\bibliography{a,b}\n\\end{document}");
    project({ "main.tex": main, "a.bib": "", "b.bib": "" }, ["main.tex"]);
    const choose = vi.fn(async (choices: readonly string[]) => choices[1]);
    const first = await ensureZoteroEntries([{ hit: hit(), key: "smithBBT2020" }], { chooseBibliography: choose });
    expect(choose).toHaveBeenCalledWith(["a.bib", "b.bib"]);
    expect(first.bibPath).toBe("b.bib");
    const second = await ensureZoteroEntries(
      [{ hit: hit({ itemKey: "DOE23456", citationKey: "doe2019", doi: undefined }), key: "doe2019" }],
      { chooseBibliography: choose },
    );
    expect(choose).toHaveBeenCalledTimes(1);
    expect(second.bibPath).toBe("b.bib");
  });
});

describe("keys cited but missing from the .bib", () => {
  it("finds them in Zotero, including former Better BibTeX keys, and lists the rest", async () => {
    project({ "main.tex": PLAIN, "refs.bib": "@article{dup,\n doi = {10.9/dup}\n}\n" }, []);
    index.intelligenceState = {
      data: {
        uses: [
          { kind: "citation", name: "smithBBT2020", resolution: "unresolved" },
          { kind: "citation", name: "smithBBT2020", resolution: "unresolved" },
          { kind: "citation", name: "oldKey", resolution: "unresolved" },
          { kind: "citation", name: "nothere", resolution: "unresolved" },
          { kind: "citation", name: "samePaper", resolution: "unresolved" },
          { kind: "citation", name: "fine", resolution: "resolved" },
          { kind: "reference", name: "fig:x", resolution: "unresolved" },
        ],
      },
    };
    mocks.lookup.mockResolvedValue([
      hit(),
      hit({ itemKey: "OLD23456", citationKey: "newKey", aliases: ["oldKey"], doi: undefined }),
      null,
      hit({ itemKey: "DUP23456", citationKey: "samePaper", doi: "10.9/dup" }),
    ]);
    const report = await findMissingInZotero();
    expect(mocks.lookup).toHaveBeenCalledWith(["smithBBT2020", "oldKey", "nothere", "samePaper"]);
    expect(report.found.map((pick) => [pick.key, pick.hit.itemKey])).toEqual([
      ["smithBBT2020", "SMITH234"],
      ["oldKey", "OLD23456"],
    ]);
    expect(report.missing).toEqual(["nothere"]);
    expect(report.duplicates).toEqual([{ key: "samePaper", existing: "dup" }]);
  });
});

describe("updating an entry that changed in Zotero", () => {
  const original = "@article{smithBBT2020,\n  title = {Deep learning},\n  doi = {10.1/smith}\n}";

  function linked(bib: string) {
    project({ "main.tex": PLAIN.replace("\\end{document}", "\\bibliography{refs}\n\\end{document}"), "refs.bib": bib }, ["refs.bib"]);
    storedLinks = {
      smithBBT2020: {
        library: "user",
        itemKey: "SMITH234",
        dateModified: "2024-01-01T00:00:00Z",
        version: 3,
        hash: entryHash(original),
        bib: "refs.bib",
      },
    };
    mocks.items.mockResolvedValue([hit({ dateModified: "2024-02-01T00:00:00Z" })]);
    mocks.exportEntries.mockResolvedValue([
      exported("smithBBT2020", {
        entry: "@article{smithBBT2020,\n  title = {Deep learning, revised},\n  doi = {10.1/smith}\n}",
        dateModified: "2024-02-01T00:00:00Z",
      }),
    ]);
  }

  it("updates an untouched entry in one click without asking", async () => {
    linked(`% top\n${original}\n\n@book{other,\n title={x}\n}\n`);
    const stale = await staleZoteroEntries();
    expect(stale).toMatchObject([{ key: "smithBBT2020", handEdited: false, bib: "refs.bib" }]);
    const confirm = vi.fn(async () => true);
    await expect(requestZoteroUpdate("smithBBT2020", confirm)).resolves.toBe("updated");
    expect(confirm).not.toHaveBeenCalled();
    expect(files.files["refs.bib"].content).toBe(
      "% top\n@article{smithBBT2020,\n  title = {Deep learning, revised},\n  doi = {10.1/smith}\n}\n\n@book{other,\n title={x}\n}\n",
    );
    expect(storedLinks.smithBBT2020.dateModified).toBe("2024-02-01T00:00:00Z");
    expect(storedLinks.smithBBT2020.hash).toBe(entryHash("@article{smithBBT2020,\n  title = {Deep learning, revised},\n  doi = {10.1/smith}\n}"));
  });

  it("asks first when the entry was edited by hand, and keeps it when the user says no", async () => {
    const edited = original.replace("Deep learning", "Deep learning (my note)");
    linked(`${edited}\n`);
    const decline = vi.fn(async () => false);
    await expect(requestZoteroUpdate("smithBBT2020", decline)).resolves.toBe("declined");
    expect(decline).toHaveBeenCalledWith([expect.objectContaining({ key: "smithBBT2020", handEdited: true })]);
    expect(mocks.setContent).not.toHaveBeenCalled();
    const accept = vi.fn(async () => true);
    await expect(requestZoteroUpdate("smithBBT2020", accept)).resolves.toBe("updated");
    expect(files.files["refs.bib"].content).toContain("Deep learning, revised");
  });

  it("reports nothing to update when Zotero has not changed", async () => {
    linked(`${original}\n`);
    mocks.items.mockResolvedValue([hit()]);
    await expect(staleZoteroEntries()).resolves.toEqual([]);
    await expect(requestZoteroUpdate("smithBBT2020", async () => true)).resolves.toBe("current");
  });
});
