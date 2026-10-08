import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ZoteroExportedEntry, ZoteroHit, ZoteroProjectLink } from "@oleafly/backend-port";

const mocks = vi.hoisted(() => ({
  exportEntries: vi.fn(),
  links: vi.fn(),
  updateLinks: vi.fn(),
  readFileContent: vi.fn(),
  setContent: vi.fn(),
  saveFile: vi.fn(),
  writeProjectFile: vi.fn(),
  updateFile: vi.fn(),
  rebuildFromDisk: vi.fn(),
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
  rememberedBibliography: () => null,
  rememberBibliography: () => undefined,
}));
vi.mock("@/lib/tauri", () => ({
  zoteroLibraryExport: mocks.exportEntries,
  zoteroProjectLinks: mocks.links,
  zoteroUpdateProjectLinks: mocks.updateLinks,
  zoteroLibraryLookup: vi.fn(),
  zoteroLibraryItems: vi.fn(),
  readFileContent: mocks.readFileContent,
}));

import { useZoteroDialogStore } from "@/store/zotero-dialogs";
import { ensureZoteroEntries, resetZoteroCiteForTest } from "./zotero-cite";
import { askHandListMove, handListEntries, handListText } from "./zotero-hand-bibliography";

const SMITH = "@article{smithBBT2020,\n  title = {Deep learning},\n  doi = {10.1/smith}\n}";
const KNUTH_ITEM = "\\bibitem{knuth1984} D.~E. Knuth, \\emph{The \\TeX book}. Addison-Wesley, 1984.";
const KNUTH_ENTRY = "@misc{knuth1984,\n  note = {D.~E. Knuth, \\emph{The \\TeX book}. Addison-Wesley, 1984.}\n}";
const LIST = `\\begin{thebibliography}{9}\n${KNUTH_ITEM}\n\\end{thebibliography}`;
const ACADEMIC = [
  "\\documentclass[11pt]{article}",
  "\\begin{document}",
  "Related work~\\cite{knuth1984} and \\cite{smithBBT2020}.",
  "",
  "\\section{Conclusion}",
  "Recap.",
  "",
  LIST,
  "",
  "\\end{document}",
  "",
].join("\n");
const MOVED = ACADEMIC.replace(LIST, "\\bibliographystyle{unsrt}\n\\bibliography{references}");
const PLAIN = "\\documentclass{article}\n\\begin{document}\nSee \\cite{smithBBT2020}.\n\\end{document}\n";

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

function exported(key: string, entry = SMITH.replace("smithBBT2020", key)): ZoteroExportedEntry {
  return {
    library: "user",
    itemKey: "SMITH234",
    citationKey: key,
    keySource: "bbt",
    entry,
    origin: "betterBibtex",
    dateModified: "2024-01-01T00:00:00Z",
    version: 3,
    doi: "10.1/smith",
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
  files.engine = { source_extensions: [main.split(".").pop() ?? "tex"], capabilities: { formatting_profile: profile } };
  index.texts = { ...sources };
}

const pick = { hit: hit(), key: "smithBBT2020" };
let disk: Record<string, string> = {};

function text(path: string): string | undefined {
  return files.files[path]?.content ?? disk[path];
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  resetZoteroCiteForTest();
  useZoteroDialogStore.setState({ handList: null });
  files.projectId = "p1";
  disk = {};
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
  mocks.links.mockResolvedValue({});
  mocks.updateLinks.mockImplementation(async (_id: string, changes: Record<string, ZoteroProjectLink | null>) => changes);
  mocks.exportEntries.mockImplementation(async (refs: { itemKey: string }[]) =>
    refs.map((ref) => (ref.itemKey === "SMITH234" ? exported("smithBBT2020") : { ...exported("doe2019"), itemKey: ref.itemKey })),
  );
});

describe("citing from Zotero in a paper with a hand-written reference list", () => {
  it("asks once, then moves the list into references.bib ahead of the Zotero entry", async () => {
    project({ "main.tex": ACADEMIC }, ["main.tex"]);
    const confirm = vi.fn(async () => true);
    const result = await ensureZoteroEntries([pick], { confirmHandList: confirm });
    expect(confirm).toHaveBeenCalledWith({ file: "main.tex", bib: "references.bib", count: 1 });
    expect(result).toMatchObject({ added: ["smithBBT2020"], bibPath: "references.bib" });
    expect(disk["references.bib"]).toBe(`${KNUTH_ENTRY}\n\n${SMITH}\n`);
    expect(text("main.tex")).toBe(MOVED);
    expect(mocks.updateFile).toHaveBeenCalledWith("main.tex", MOVED);

    const second = await ensureZoteroEntries(
      [{ hit: hit({ itemKey: "DOE23456", citationKey: "doe2019", doi: undefined }), key: "doe2019" }],
      { confirmHandList: confirm },
    );
    expect(second.added).toEqual(["doe2019"]);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(text("main.tex")).toBe(MOVED);
  });

  it("keeps what the user typed while the .bib was being written", async () => {
    project({ "main.tex": ACADEMIC }, ["main.tex"]);
    mocks.writeProjectFile.mockImplementation(async (_id: string, path: string, content: string) => {
      disk[path] = content;
      files.files["main.tex"].content = files.files["main.tex"].content.replace("Recap.", "Recap, typed meanwhile.");
    });
    await ensureZoteroEntries([pick], { confirmHandList: async () => true });
    expect(text("main.tex")).toBe(MOVED.replace("Recap.", "Recap, typed meanwhile."));
  });

  it("aborts the whole add when the user cancels", async () => {
    project({ "main.tex": ACADEMIC }, ["main.tex"]);
    const confirm = vi.fn(async () => false);
    const result = await ensureZoteroEntries([pick], { confirmHandList: confirm });
    expect(result).toEqual({ added: [], reused: [], bibPath: null });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(mocks.exportEntries).not.toHaveBeenCalled();
    expect(mocks.setContent).not.toHaveBeenCalled();
    expect(mocks.writeProjectFile).not.toHaveBeenCalled();
    expect(mocks.updateLinks).not.toHaveBeenCalled();
    expect(text("main.tex")).toBe(ACADEMIC);
  });

  it("asks through the Zotero dialog when the caller passes no confirm", async () => {
    project({ "main.tex": ACADEMIC }, ["main.tex"]);
    const pending = ensureZoteroEntries([pick]);
    await vi.waitFor(() => expect(useZoteroDialogStore.getState().handList).not.toBeNull());
    expect(useZoteroDialogStore.getState().handList?.value).toEqual({ file: "main.tex", bib: "references.bib", count: 1 });
    useZoteroDialogStore.getState().handList?.resolve(true);
    await expect(pending).resolves.toMatchObject({ added: ["smithBBT2020"] });
    expect(useZoteroDialogStore.getState().handList).toBeNull();
    expect(text("main.tex")).toBe(MOVED);
  });

  it("moves a list kept in an included file and points at the .bib from the main document", async () => {
    const main = "\\documentclass{article}\n\\begin{document}\n\\cite{knuth1984}\n\\input{back/refs}\n\\end{document}\n";
    const refs = `% back matter\n${LIST}\n`;
    project({ "paper/main.tex": main, "paper/back/refs.tex": refs }, ["paper/main.tex"], "latex", "paper/main.tex");
    const confirm = vi.fn(async () => true);
    await ensureZoteroEntries([pick], { confirmHandList: confirm });
    expect(confirm).toHaveBeenCalledWith({ file: "paper/back/refs.tex", bib: "references.bib", count: 1 });
    expect(disk["paper/back/refs.tex"]).toBe("% back matter\n\\bibliographystyle{unsrt}\n\\bibliography{../references}\n");
    expect(mocks.updateFile).toHaveBeenCalledWith("paper/back/refs.tex", disk["paper/back/refs.tex"]);
    expect(text("paper/main.tex")).toBe(main);
    expect(disk["references.bib"]).toBe(`${KNUTH_ENTRY}\n\n${SMITH}\n`);
  });

  it("skips hand entries whose keys the .bib already has", async () => {
    const main = ACADEMIC.replace(KNUTH_ITEM, `${KNUTH_ITEM}\n\\bibitem[Lamport(1994)]{lamport:94-latex} L.~Lamport,\n  \\emph{\\LaTeX}. % second edition\n  1994.`);
    const bib = "@book{knuth1984,\n  title = {The {\\TeX}book}\n}\n";
    project({ "main.tex": main, "refs.bib": bib }, ["main.tex"]);
    await ensureZoteroEntries([pick], { confirmHandList: async () => true });
    expect(disk["refs.bib"] ?? text("refs.bib")).toBe(
      `${bib}\n@misc{lamport:94-latex,\n  note = {L.~Lamport, \\emph{\\LaTeX}. 1994.}\n}\n\n${SMITH}\n`,
    );
    expect(text("main.tex")).toContain("\\bibliographystyle{unsrt}\n\\bibliography{refs}\n\n\\end{document}");
  });

  it("lets the Zotero entry win when a hand item has the same key", async () => {
    const main = ACADEMIC.replace(KNUTH_ITEM, `${KNUTH_ITEM}\n\\bibitem{smithBBT2020} J. Smith, Deep learning.`);
    project({ "main.tex": main }, ["main.tex"]);
    await ensureZoteroEntries([pick], { confirmHandList: async () => true });
    expect(disk["references.bib"]).toBe(`${KNUTH_ENTRY}\n\n${SMITH}\n`);
  });

  it("keeps today's behavior when there is more than one list", async () => {
    const main = ACADEMIC.replace(LIST, `${LIST}\n${LIST.replace("knuth1984", "other")}`);
    project({ "main.tex": main }, ["main.tex"]);
    const confirm = vi.fn(async () => true);
    await ensureZoteroEntries([pick], { confirmHandList: confirm });
    expect(confirm).not.toHaveBeenCalled();
    expect(disk["references.bib"]).toBe(`${SMITH}\n`);
    expect(text("main.tex")).toContain(`${LIST}\n`);
    expect(text("main.tex")).toContain("\\bibliographystyle{plain}\n\\bibliography{references}\n\\end{document}");
  });

  it("keeps today's behavior exactly for a paper without a hand list", async () => {
    project({ "main.tex": PLAIN }, ["main.tex"]);
    const confirm = vi.fn(async () => true);
    const result = await ensureZoteroEntries([pick], { confirmHandList: confirm });
    expect(confirm).not.toHaveBeenCalled();
    expect(result).toEqual({ added: ["smithBBT2020"], reused: [], bibPath: "references.bib" });
    expect(disk["references.bib"]).toBe(`${SMITH}\n`);
    expect(text("main.tex")).toBe(
      "\\documentclass{article}\n\\begin{document}\nSee \\cite{smithBBT2020}.\n\\bibliographystyle{plain}\n\\bibliography{references}\n\\end{document}\n",
    );
  });

  it("does not ask when the paper already declares a .bib or the key is already there", async () => {
    const declared = ACADEMIC.replace("\\end{document}", "\\bibliography{refs}\n\\end{document}");
    project({ "main.tex": declared, "refs.bib": "" }, ["main.tex"]);
    const confirm = vi.fn(async () => true);
    await ensureZoteroEntries([pick], { confirmHandList: confirm });
    expect(confirm).not.toHaveBeenCalled();
    expect(text("main.tex")).toBe(declared);

    project({ "main.tex": ACADEMIC, "refs.bib": SMITH }, ["main.tex"]);
    const reused = await ensureZoteroEntries([pick], { confirmHandList: confirm });
    expect(reused.reused).toEqual(["smithBBT2020"]);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("deciding whether to offer the move", () => {
  const sources = [{ file: "main.tex", content: ACADEMIC }];

  it("only offers it for LaTeX papers writing to a .bib file", async () => {
    project({ "main.tex": ACADEMIC });
    const confirm = vi.fn(async () => true);
    await expect(askHandListMove({ sources, target: "refs.yml", confirm })).resolves.toBeNull();
    files.engine = { source_extensions: ["typ"], capabilities: { formatting_profile: "typst" } };
    await expect(askHandListMove({ sources, target: "references.bib", confirm })).resolves.toBeNull();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("leaves biblatex papers, read-only files and lists it cannot convert alone", async () => {
    const confirm = vi.fn(async () => true);
    project({ "main.tex": ACADEMIC });
    const biblatex = [{ file: "main.tex", content: ACADEMIC.replace("\\begin{document}", "\\usepackage{biblatex}\n\\begin{document}") }];
    await expect(askHandListMove({ sources: biblatex, target: "references.bib", confirm })).resolves.toBeNull();
    const broken = [{ file: "main.tex", content: ACADEMIC.replace("Addison-Wesley", "Addison-Wesley \\{") }];
    await expect(askHandListMove({ sources: broken, target: "references.bib", confirm })).resolves.toBeNull();
    files.tree = [{ path: "main.tex", is_dir: false, read_only: true }];
    await expect(askHandListMove({ sources, target: "references.bib", confirm })).resolves.toBeNull();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("does not edit when the list changed after the user agreed", () => {
    const gone = [{ file: "main.tex", content: PLAIN }];
    expect(handListEntries({ file: "main.tex" }, { sources: gone, bib: "", adding: [] })).toEqual([]);
    expect(handListText({ file: "main.tex" }, gone, "references.bib")).toBeNull();
    expect(handListEntries({ file: "other.tex" }, { sources, bib: "", adding: [] })).toEqual([]);
    expect(handListText({ file: "other.tex" }, sources, "references.bib")).toBeNull();
  });
});
