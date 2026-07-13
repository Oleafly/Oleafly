import { describe, expect, it, vi } from "vitest";

// The bridge imports the app tool registry, which pulls stores + tauri; mock
// the heavy edges the same way src/lib/ai-tools.test.ts does.
const mocks = vi.hoisted(() => ({
  api: {
    readFileContent: vi.fn(),
    writeFileContent: vi.fn(),
    createFile: vi.fn(),
    deleteFile: vi.fn(),
    renameFile: vi.fn(),
    setMainDocCmd: vi.fn(),
    listFiles: vi.fn(),
    searchProject: vi.fn(),
    appVersion: vi.fn(async () => "0.0.0"),
    listProjects: vi.fn(async () => []),
    getConfig: vi.fn(async () => ({
      mcp_enabled: false,
      mcp_port: 5323,
      mcp_read_only: false,
      mcp_approval_policy: "ask",
    })),
    mcpRegisterTools: vi.fn(async () => {}),
    mcpToolResult: vi.fn(async () => {}),
    appendAppLog: vi.fn(async () => {}),
    readProjectBytes: vi.fn(),
    writeProjectBytes: vi.fn(),
    compileIsolated: vi.fn(),
    readIsolatedPdf: vi.fn(),
  },
  filesState: {
    projectId: "proj" as string | null,
    mainDoc: "main.tex",
    applyExternalWrite: vi.fn(),
    applyExternalDelete: vi.fn(),
    applyExternalRename: vi.fn(),
    refreshTree: vi.fn(),
    openProject: vi.fn(),
  },
  compileState: {
    recompile: vi.fn(),
    log: "",
    pdfBytes: null as Uint8Array | null,
    status: "idle",
  },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@/lib/tauri", () => mocks.api);
vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => mocks.filesState, setState: vi.fn() },
}));
vi.mock("@/store/compile", () => ({ useCompileStore: { getState: () => mocks.compileState } }));
vi.mock("@/lib/pdf-text", () => ({ extractPdfText: vi.fn() }));
vi.mock("@/lib/pdf-image", () => ({ pdfPageToPng: vi.fn() }));

import { buildMcpToolRegistry, confirmForPolicy, toMcpResult, rawSchemaOf } from "@/lib/mcp-bridge";

describe("mcp tool registry", () => {
  const registry = buildMcpToolRegistry({
    confirm: async () => true,
    readOnly: false,
    onImage: () => {},
  });

  it("mirrors the in-app agent tools one to one", () => {
    for (const name of [
      "read_file",
      "write_file",
      "replace_in_file",
      "create_file",
      "rename_file",
      "delete_file",
      "compile",
      "get_log",
      "get_pdf_text",
      "set_main_doc",
      "search_project",
      "list_files",
      "toggle_theme",
      "project_map",
      "preview_figure",
      "insert_figure",
      "load_image",
    ]) {
      expect(registry[name], name).toBeDefined();
    }
  });

  it("adds the MCP-only orientation tools", () => {
    expect(registry.get_status).toBeDefined();
    expect(registry.list_projects).toBeDefined();
    expect(registry.open_project).toBeDefined();
  });

  it("read-only mode strips every mutating tool", () => {
    const ro = buildMcpToolRegistry({
      confirm: async () => true,
      readOnly: true,
      onImage: () => {},
    });
    for (const name of [
      "write_file",
      "replace_in_file",
      "create_file",
      "rename_file",
      "delete_file",
      "set_main_doc",
      "insert_figure",
      "toggle_theme",
      "open_project",
    ]) {
      expect(ro[name], name).toBeUndefined();
    }
    expect(ro.read_file).toBeDefined();
    expect(ro.compile).toBeDefined();
  });

  it("exposes a plain JSON schema for every tool", () => {
    for (const [name, entry] of Object.entries(registry)) {
      const schema = rawSchemaOf(entry.inputSchema) as { type?: string };
      expect(schema?.type, name).toBe("object");
    }
  });
});

describe("confirmForPolicy", () => {
  // A request() that records whether it was consulted and always denies, so we
  // can tell "prompted" (returns false) from "auto-approved" (returns true).
  const denyingRequest = () => {
    let prompted = false;
    const fn = async () => {
      prompted = true;
      return false;
    };
    return { fn, wasPrompted: () => prompted };
  };
  const req = (tool: string) => ({ tool, summary: `${tool} x` });

  it("ask: prompts for every change, writes and deletes alike", async () => {
    const r = denyingRequest();
    const confirm = confirmForPolicy("ask", r.fn);
    expect(await confirm(req("write_file"))).toBe(false);
    expect(await confirm(req("delete_file"))).toBe(false);
    expect(r.wasPrompted()).toBe(true);
  });

  it("unknown/legacy policy falls back to ask", async () => {
    const r = denyingRequest();
    const confirm = confirmForPolicy("", r.fn);
    expect(await confirm(req("write_file"))).toBe(false);
    expect(r.wasPrompted()).toBe(true);
  });

  it("auto_writes: writes auto-approve, deletes still prompt", async () => {
    const r = denyingRequest();
    const confirm = confirmForPolicy("auto_writes", r.fn);
    expect(await confirm(req("write_file"))).toBe(true);
    expect(await confirm(req("replace_in_file"))).toBe(true);
    // A delete is never auto-approvable, so it routes through request() (deny).
    expect(await confirm(req("delete_file"))).toBe(false);
    expect(r.wasPrompted()).toBe(true);
  });

  it("trust: never prompts, deletes included", async () => {
    const r = denyingRequest();
    const confirm = confirmForPolicy("trust", r.fn);
    expect(await confirm(req("write_file"))).toBe(true);
    expect(await confirm(req("delete_file"))).toBe(true);
    expect(r.wasPrompted()).toBe(false);
  });
});

describe("toMcpResult", () => {
  it("wraps a plain result as text content", () => {
    const r = toMcpResult({ success: true, path: "main.tex" }, []);
    expect(r.isError).toBeUndefined();
    expect(r.content).toEqual([{ type: "text", text: '{"success":true,"path":"main.tex"}' }]);
  });

  it("flags tool-level errors with isError", () => {
    const r = toMcpResult({ error: "No project open" }, []);
    expect(r.isError).toBe(true);
  });

  it("prepends captured images as image content", () => {
    const r = toMcpResult({ success: true }, ["data:image/png;base64,QUJD"]);
    expect(r.content[0]).toEqual({ type: "image", data: "QUJD", mimeType: "image/png" });
    expect(r.content[1].type).toBe("text");
  });
});
