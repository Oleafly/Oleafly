import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  setFocus: vi.fn(async () => {}),
  channels: [] as Array<{ onmessage: (value: unknown) => void }>,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  Channel: class {
    onmessage: (value: unknown) => void = () => {};
    constructor() {
      mocks.channels.push(this);
    }
  },
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setFocus: mocks.setFocus }) }));

import * as tauri from "./tauri";

beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue(undefined);
  mocks.setFocus.mockClear();
  mocks.channels = [];
});

describe("IPC command contract", () => {
  it.each([
    ["reloadViews", () => tauri.reloadViews(), "reload_views", undefined],
    ["importOverleafProjectCmd without a name", () => tauri.importOverleafProjectCmd("/x.zip"), "import_overleaf_project", { path: "/x.zip", name: null }],
    ["importOverleafProjectCmd with a name", () => tauri.importOverleafProjectCmd("/x.zip", "Thesis"), "import_overleaf_project", { path: "/x.zip", name: "Thesis" }],
    [
      "compileProject defaults",
      () => tauri.compileProject("p", "main.tex"),
      "compile_project",
      expect.objectContaining({ projectId: "p", mainDoc: "main.tex", offline: false, fast: false, haltOnError: false, typstVariant: null }),
    ],
    ["cancelCompile", () => tauri.cancelCompile(), "cancel_compile", {}],
    ["compileIsolated defaults to online", () => tauri.compileIsolated("p", "src"), "compile_isolated", { projectId: "p", source: "src", offline: false }],
    ["readFileContent", () => tauri.readFileContent("p", "a.tex"), "read_file", { projectId: "p", path: "a.tex" }],
    ["readFileContent allowing a missing file", () => tauri.readFileContent("p", "a.tex", true), "read_file", { projectId: "p", path: "a.tex", allowMissing: true }],
    ["readProjectSourcesBatch", () => tauri.readProjectSourcesBatch("p", { paths: [] } as never), "read_project_sources", { projectId: "p", request: { paths: [] } }],
    ["documentStats", () => tauri.documentStats("p", { mainDoc: "m" } as never), "document_stats", { projectId: "p", request: { mainDoc: "m" } }],
    ["ragRetrieve", () => tauri.ragRetrieve("p", { query: "q" } as never), "rag_retrieve", { projectId: "p", request: { query: "q" } }],
    ["pickTableImportFile", () => tauri.pickTableImportFile(), "pick_table_import_file", undefined],
    ["setProjectEngineCmd keeps auto-detection", () => tauri.setProjectEngineCmd("p", "latexmk"), "set_project_engine", { projectId: "p", engine: "latexmk", flavor: null }],
    ["setProjectDictionaryLocaleCmd", () => tauri.setProjectDictionaryLocaleCmd("p", null), "set_project_dictionary_locale", { projectId: "p", locale: null }],
    ["openDevtools", () => tauri.openDevtools(), "open_devtools", undefined],
    ["listProjects", () => tauri.listProjects(), "list_projects", undefined],
    ["libraryStorageSummary", () => tauri.libraryStorageSummary(), "library_storage_summary", undefined],
    ["listRecycledProjects", () => tauri.listRecycledProjects(), "list_recycled_projects", undefined],
    [
      "createProjectFromPdfConversion",
      () => tauri.createProjectFromPdfConversion("Paper", "tex", [{ name: "f.png", dataBase64: "AA" }]),
      "create_project_from_pdf_conversion",
      { name: "Paper", tex: "tex", figures: [{ name: "f.png", dataBase64: "AA" }] },
    ],
    ["createDiagramProject without a language", () => tauri.createDiagramProject("D", "x"), "create_diagram_project", { name: "D", source: "x", language: null }],
    ["createDiagramProject with a language", () => tauri.createDiagramProject("D", "x", "mermaid"), "create_diagram_project", { name: "D", source: "x", language: "mermaid" }],
    ["getOrCreateScratchProject", () => tauri.getOrCreateScratchProject(), "get_or_create_scratch_project", undefined],
    ["saveCustomTemplate", () => tauri.saveCustomTemplate("s", "{}", []), "save_custom_template", { slug: "s", manifestJson: "{}", files: [] }],
    ["listTemplates", () => tauri.listTemplates(), "list_templates", undefined],
    ["createProjectFromTemplate", () => tauri.createProjectFromTemplate("N", "t", "#fff"), "create_project_from_template", { name: "N", templateId: "t", color: "#fff" }],
    ["downloadAllFonts", () => tauri.downloadAllFonts(), "download_all_fonts", undefined],
    ["readDeadlines", () => tauri.readDeadlines(), "read_deadlines", undefined],
    ["refreshDeadlines", () => tauri.refreshDeadlines(), "refresh_deadlines", undefined],
    ["revealProject at the root", () => tauri.revealProject("p"), "reveal_project", { projectId: "p", path: null }],
    ["revealProject at a file", () => tauri.revealProject("p", "a.tex"), "reveal_project", { projectId: "p", path: "a.tex" }],
    ["pendingOpenRequests", () => tauri.pendingOpenRequests(), "pending_open_requests", undefined],
    ["beginOpenSession", () => tauri.beginOpenSession(), "begin_open_session", undefined],
    ["pickOpenFolder", () => tauri.pickOpenFolder(), "pick_open_folder", { browse: null }],
    ["claimQuickActionOffer", () => tauri.claimQuickActionOffer(), "claim_quick_action_offer", undefined],
    [
      "exportDocument defaults",
      () => tauri.exportDocument("p", "main.typ", "pdf", "/out.pdf"),
      "export_document",
      { projectId: "p", mainDoc: "main.typ", format: "pdf", dest: "/out.pdf", typstVariant: null },
    ],
    ["downloadPandoc", () => tauri.downloadPandoc(), "download_pandoc", undefined],
    ["hasTaggingEngine", () => tauri.hasTaggingEngine(), "has_tagging_engine", undefined],
    ["confirmQuitDuringInstall", () => tauri.confirmQuitDuringInstall(), "confirm_quit_during_install", undefined],
    ["importArxivEprint without a name", () => tauri.importArxivEprint("2101.1"), "import_arxiv_eprint", { arxivId: "2101.1", name: null }],
    ["importArxivEprint with a name", () => tauri.importArxivEprint("2101.1", "Paper"), "import_arxiv_eprint", { arxivId: "2101.1", name: "Paper" }],
    ["statsPValue without degrees of freedom", () => tauri.statsPValue("z", 1.96), "stats_p_value", { test: "z", statistic: 1.96, df: null }],
    ["statsPValue with degrees of freedom", () => tauri.statsPValue("t", 2, 10), "stats_p_value", { test: "t", statistic: 2, df: 10 }],
    [
      "statsSampleSize for an infinite population",
      () => tauri.statsSampleSize(0.5, 0.05, 0.95),
      "stats_sample_size",
      { proportion: 0.5, marginError: 0.05, confidence: 0.95, population: null },
    ],
    [
      "statsSampleSize for a finite population",
      () => tauri.statsSampleSize(0.5, 0.05, 0.95, 1000),
      "stats_sample_size",
      { proportion: 0.5, marginError: 0.05, confidence: 0.95, population: 1000 },
    ],
    [
      "statsConfidenceInterval for a proportion",
      () => tauri.statsConfidenceInterval("proportion", 0.95, { n: 100, successes: 40 }),
      "stats_confidence_interval",
      { mode: "proportion", confidence: 0.95, mean: null, sd: null, n: 100, successes: 40 },
    ],
    [
      "statsConfidenceInterval for a mean",
      () => tauri.statsConfidenceInterval("mean", 0.9, { mean: 3, sd: 1, n: 9 }),
      "stats_confidence_interval",
      { mode: "mean", confidence: 0.9, mean: 3, sd: 1, n: 9, successes: null },
    ],
    [
      "literatureSearch defaults",
      () => tauri.literatureSearch("crossref", "graphs"),
      "literature_search",
      { source: "crossref", query: "graphs", limit: 12, yearFrom: null, yearTo: null, openAccessOnly: false },
    ],
    [
      "literatureSearch options",
      () => tauri.literatureSearch("arxiv", "q", { limit: 5, yearFrom: 2000, yearTo: 2020, openAccessOnly: true }),
      "literature_search",
      { source: "arxiv", query: "q", limit: 5, yearFrom: 2000, yearTo: 2020, openAccessOnly: true },
    ],
    ["zoteroLibraryBibtex", () => tauri.zoteroLibraryBibtex(), "zotero_library_bibtex", undefined],
    ["redactedSecretMarker", () => tauri.redactedSecretMarker(), "redacted_secret_marker", undefined],
    ["agentServerResolveRequest without a payload", () => tauri.agentServerResolveRequest("r", "allow" as never), "agent_server_resolve_request", { requestId: "r", decision: "allow", payload: null }],
    ["agentServerResolveRequest with a payload", () => tauri.agentServerResolveRequest("r", "allow" as never, { a: 1 }), "agent_server_resolve_request", { requestId: "r", decision: "allow", payload: { a: 1 } }],
    ["gitDiff of the worktree", () => tauri.gitDiff("p"), "git_diff", { projectId: "p", path: null, staged: false }],
    ["gitDiff of a staged file", () => tauri.gitDiff("p", "a.tex", true), "git_diff", { projectId: "p", path: "a.tex", staged: true }],
    ["libraryRoot", () => tauri.libraryRoot(), "library_root", undefined],
    ["appVersion", () => tauri.appVersion(), "app_version", undefined],
    ["agentExec", () => tauri.agentExec("p", "ls", "run", "token"), "agent_exec", { projectId: "p", command: "ls", runId: "run", approvalToken: "token" }],
    ["backendProtocolInfo", () => tauri.backendProtocolInfo(), "backend_protocol_info", undefined],
    ["initialState", () => tauri.initialState(), "initial_state", undefined],
    ["approvalsSet", () => tauri.approvalsSet("p", "write_file", null), "approvals_set", { projectId: "p", tool: "write_file", decision: null }],
    ["synctexForward", () => tauri.synctexForward("p", "main.tex", "a.tex", 3), "synctex_forward", { projectId: "p", mainDoc: "main.tex", file: "a.tex", line: 3 }],
    ["synctexInverse", () => tauri.synctexInverse("p", "main.tex", 2, 10, 20), "synctex_inverse", { projectId: "p", mainDoc: "main.tex", page: 2, x: 10, y: 20 }],
    [
      "synctexMapLine",
      () => tauri.synctexMapLine("old", "new", 4, true),
      "synctex_map_line",
      { compiledSource: "old", currentSource: "new", line: 4, currentToCompiled: true },
    ],
  ] as const)("sends %s", async (_label, call, command, args) => {
    await call();
    if (args === undefined) expect(mocks.invoke).toHaveBeenCalledWith(command);
    else expect(mocks.invoke).toHaveBeenCalledWith(command, args);
  });
});

describe("IPC helpers with client-side logic", () => {
  it("focuses the current window", async () => {
    await tauri.focusCurrentWindow();
    expect(mocks.setFocus).toHaveBeenCalledOnce();
  });

  it("maps the figure cache reply to camel case", async () => {
    mocks.invoke.mockResolvedValue({ hash: "abc", already_cached: true });
    await expect(tauri.saveFigureToCache("fig", "AAAA", "\\draw;")).resolves.toEqual({ hash: "abc", alreadyCached: true });
    expect(mocks.invoke).toHaveBeenCalledWith("save_figure_to_cache", { name: "fig", pngBase64: "AAAA", tikz: "\\draw;" });
  });

  function dictionaryPayload(aff: string, dic: string, declared = aff.length): ArrayBuffer {
    const encoder = new TextEncoder();
    const affBytes = encoder.encode(aff);
    const dicBytes = encoder.encode(dic);
    const bytes = new Uint8Array(8 + affBytes.length + dicBytes.length);
    new DataView(bytes.buffer).setBigUint64(0, BigInt(declared), true);
    bytes.set(affBytes, 8);
    bytes.set(dicBytes, 8 + affBytes.length);
    return bytes.buffer;
  }

  it("splits a dictionary payload into its affix and word files", async () => {
    mocks.invoke.mockResolvedValue(dictionaryPayload("SET UTF-8", "1\nword"));
    const result = await tauri.readDictionary("en_US");
    expect(mocks.invoke).toHaveBeenCalledWith("read_dictionary", { id: "en_US" });
    expect(new TextDecoder().decode(result.aff)).toBe("SET UTF-8");
    expect(new TextDecoder().decode(result.dic)).toBe("1\nword");
  });

  it.each([
    ["a payload with no content", new Uint8Array(8).buffer],
    ["an empty affix file", dictionaryPayload("", "1\nword")],
    ["an affix length past the end", dictionaryPayload("SET", "1\nw", 50)],
    ["no word file", dictionaryPayload("SET UTF-8", "")],
  ])("rejects %s", async (_label, payload) => {
    mocks.invoke.mockResolvedValue(payload);
    await expect(tauri.readDictionary("en_US")).rejects.toThrow("The spelling dictionary payload is incomplete.");
  });

  it("streams copy-into-library progress and detaches the listener afterwards", async () => {
    const onProgress = vi.fn();
    mocks.invoke.mockImplementation(async (_command: string, args: { onProgress: { onmessage: (value: unknown) => void } }) => {
      args.onProgress.onmessage({ phase: "copying", entriesDone: 1, entriesTotal: 2, bytesDone: 1, bytesTotal: 2 });
      return { projectId: "copy", leftOut: 0 };
    });
    await expect(tauri.copyLinkedIntoLibrary("p", "op", onProgress)).resolves.toEqual({ projectId: "copy", leftOut: 0 });
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ phase: "copying", entriesDone: 1 }));
    expect(mocks.invoke).toHaveBeenCalledWith("copy_linked_into_library", {
      projectId: "p",
      operationId: "op",
      onProgress: mocks.channels[0],
    });
    mocks.channels[0].onmessage({ phase: "copying" });
    expect(onProgress).toHaveBeenCalledTimes(1);
  });

  it("detaches the progress listener when the copy fails", async () => {
    const onProgress = vi.fn();
    mocks.invoke.mockRejectedValue(new Error("disk full"));
    await expect(tauri.copyLinkedIntoLibrary("p", "op", onProgress)).rejects.toThrow("disk full");
    mocks.channels[0].onmessage({ phase: "copying" });
    expect(onProgress).not.toHaveBeenCalled();
  });
});

describe("MCP renderer session bookkeeping", () => {
  it("keeps only the newest overlapping session and forgets it when it ends", async () => {
    const begins: Array<(value: number) => void> = [];
    mocks.invoke.mockImplementation((command: string) =>
      command === "mcp_begin_renderer_session"
        ? new Promise<number>((resolve) => begins.push(resolve))
        : Promise.resolve(undefined),
    );
    const first = tauri.mcpBeginRendererSession();
    const second = tauri.mcpBeginRendererSession();
    begins[1](8);
    await expect(second).resolves.toBe(8);
    begins[0](7);
    await expect(first).resolves.toBe(7);

    await tauri.mcpSetActiveProject("project");
    expect(mocks.invoke).toHaveBeenLastCalledWith("mcp_set_active_project", { projectId: "project", rendererSession: 8 });

    await tauri.mcpEndRendererSession(7);
    await tauri.mcpSetActiveProject(null);
    expect(mocks.invoke).toHaveBeenLastCalledWith("mcp_set_active_project", { projectId: null, rendererSession: 8 });

    await tauri.mcpEndRendererSession(8);
    await expect(tauri.mcpSetActiveProject("project")).rejects.toThrow("The MCP renderer session is not ready");
  });
});
