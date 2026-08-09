import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The bridge imports the app tool registry, which pulls stores + tauri; mock
// the heavy edges the same way src/lib/ai-tools.test.ts does.
const mocks = vi.hoisted(() => ({
  events: new Map<string, (event: { payload: unknown }) => void>(),
  listen: vi.fn(
    async (name: string, handler: (event: { payload: unknown }) => void) => {
      mocks.events.set(name, handler);
      return () => mocks.events.delete(name);
    },
  ),
  api: {
    readFileContent: vi.fn(),
    writeFileContent: vi.fn(),
    createFile: vi.fn(),
    deleteFile: vi.fn(),
    renameFile: vi.fn(),
    projectMutationGeneration: vi.fn(async () => 0),
    setMainDocCmd: vi.fn(),
    listFiles: vi.fn(),
    searchProject: vi.fn(),
    appVersion: vi.fn(async () => "0.0.0"),
    listProjects: vi.fn(async (): Promise<Array<{ id: string; name: string }>> => []),
    getConfig: vi.fn(async () => ({
      mcp_enabled: false,
      mcp_port: 5323,
      mcp_read_only: false,
      mcp_approval_policy: "ask",
    })),
    mcpBeginRendererSession: vi.fn(async () => 41),
    mcpEndRendererSession: vi.fn(async () => {}),
    mcpRendererHeartbeat: vi.fn(async () => {}),
    mcpRegisterTools: vi.fn(async () => {}),
    mcpStatus: vi.fn(async () => ({ running: false, port: null, url: null, enabled: false })),
    mcpSetActiveProject: vi.fn(async () => {}),
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
    loading: false,
    applyExternalWrite: vi.fn(() => true),
    applyExternalDelete: vi.fn(() => true),
    applyExternalRename: vi.fn(() => true),
    prepareExternalMutation: vi.fn(async () => 0),
    recordMutationGeneration: vi.fn(),
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
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@/lib/tauri", () => mocks.api);
vi.mock("@/store/files", () => ({
  useFilesStore: { getState: () => mocks.filesState, setState: vi.fn() },
}));
vi.mock("@/store/compile", () => ({ useCompileStore: { getState: () => mocks.compileState } }));
vi.mock("@/lib/pdf-text", () => ({ extractPdfText: vi.fn() }));
vi.mock("@/lib/pdf-image", () => ({ pdfPageToPng: vi.fn() }));

import {
  buildMcpToolRegistry,
  confirmForPolicy,
  toMcpResult,
  rawSchemaOf,
  startMcpBridge,
  validateToolInput,
} from "@/lib/mcp-bridge";

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
      "update_todos",
      "remember_note",
      "forget_note",
    ]) {
      expect(ro[name], name).toBeUndefined();
    }
    expect(ro.read_file).toBeDefined();
    expect(ro.compile).toBeDefined();
  });

  it("keeps the Rust fail-safe mutation list in parity with the webview registry", () => {
    const ro = buildMcpToolRegistry({
      confirm: async () => true,
      readOnly: true,
      onImage: () => {},
    });
    const removed = Object.keys(registry).filter((name) => !ro[name]).sort();
    const rust = readFileSync(
      join(process.cwd(), "src-tauri/src/mcp/native.rs"),
      "utf8",
    );
    const block = rust.slice(rust.indexOf("const MUTATING"), rust.indexOf("pub fn is_mutating"));
    const backend = [...block.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]).sort();

    expect(backend).toEqual(removed);
  });

  it("exposes a plain JSON schema for every tool", () => {
    for (const [name, entry] of Object.entries(registry)) {
      const schema = rawSchemaOf(entry.inputSchema) as { type?: string };
      expect(schema?.type, name).toBe("object");
    }
  });

  it("open_project verifies that the requested project actually became active", async () => {
    mocks.api.listProjects.mockResolvedValue([{ id: "next", name: "Next" }]);
    mocks.filesState.projectId = "proj";
    mocks.filesState.loading = false;
    mocks.filesState.openProject.mockResolvedValue(undefined);
    const local = buildMcpToolRegistry({
      confirm: async () => true,
      readOnly: false,
      onImage: () => {},
      mutationAllowed: () => true,
    });

    const result = await local.open_project.execute({ project_id: "next" });

    expect(result).toMatchObject({ error: expect.stringContaining("could not be opened") });
    expect(mocks.filesState.openProject).toHaveBeenCalledWith("next", expect.any(Function));
  });

  it("validates required fields, types, bounds, and unexpected arguments", () => {
    const schema = rawSchemaOf(registry.replace_in_file.inputSchema);
    expect(validateToolInput(schema, { path: "main.tex", find: "", replace: "x" })).toContain(
      "at least 1",
    );
    expect(validateToolInput(schema, { path: "main.tex", find: "x", replace: "y" })).toBeNull();
    expect(
      validateToolInput(schema, { path: "main.tex", find: "x", replace: "y", surprise: true }),
    ).toContain("not allowed");
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

  it("preserves supported image media types", () => {
    const r = toMcpResult({ success: true }, ["data:image/jpeg;base64,QUJD"]);
    expect(r.content[0]).toEqual({ type: "image", data: "QUJD", mimeType: "image/jpeg" });
  });

  it("refuses oversized text results instead of retaining an unbounded response", () => {
    const r = toMcpResult({ content: "x".repeat(2 * 1024 * 1024 + 1) }, []);
    expect(r.isError).toBe(true);
    expect(r.content.at(-1)).toMatchObject({
      type: "text",
      text: expect.stringContaining("response limit"),
    });
  });
});

describe("MCP renderer lifecycle", () => {
  it("correlates events to one leased renderer session and stops when superseded", async () => {
    const heartbeats: Array<() => void> = [];
    const clearInterval = vi.fn();
    const addEventListener = vi.fn();
    vi.stubGlobal("window", {
      setInterval: vi.fn((callback: () => void) => {
        heartbeats.push(callback);
        return 1;
      }),
      clearInterval,
      addEventListener,
    });

    await startMcpBridge();

    const listenerOrders = mocks.listen.mock.invocationCallOrder;
    expect(Math.max(...listenerOrders)).toBeLessThan(
      mocks.api.mcpBeginRendererSession.mock.invocationCallOrder[0],
    );
    expect(mocks.api.mcpRegisterTools).toHaveBeenCalledWith(expect.any(Array), 41);
    expect(mocks.api.mcpSetActiveProject).toHaveBeenCalledWith("proj");
    expect(heartbeats).toHaveLength(1);
    expect(addEventListener).toHaveBeenCalledWith("pagehide", expect.any(Function));

    const emit = (name: string, payload: unknown) => {
      const handler = mocks.events.get(name);
      expect(handler, `${name} listener`).toBeDefined();
      handler?.({ payload });
    };

    mocks.api.mcpToolResult.mockClear();
    emit("mcp:tool-call", {
      callId: 1,
      epoch: 7,
      rendererSession: 40,
      name: "not_a_tool",
      arguments: {},
    });
    await Promise.resolve();
    expect(mocks.api.mcpToolResult).not.toHaveBeenCalled();

    emit("mcp:requests-revoked", {
      epoch: 7,
      rendererSession: 41,
      reason: "tool-registry-changed",
    });
    emit("mcp:requests-revoked", {
      epoch: 8,
      rendererSession: 41,
      reason: "renderer-lease-expired",
    });
    heartbeats[0]();
    await vi.waitFor(() => expect(mocks.api.mcpRendererHeartbeat).toHaveBeenCalledWith(41));

    emit("mcp:tool-call", {
      callId: 2,
      epoch: 9,
      rendererSession: 41,
      name: "not_a_tool",
      arguments: {},
    });
    await vi.waitFor(() =>
      expect(mocks.api.mcpToolResult).toHaveBeenCalledWith(
        2,
        expect.objectContaining({ isError: true }),
        41,
      ),
    );

    emit("mcp:requests-revoked", {
      epoch: 10,
      rendererSession: 42,
      reason: "renderer-session-changed",
    });
    expect(clearInterval).toHaveBeenCalledWith(1);
    const callsBeforeStaleHeartbeat = mocks.api.mcpRendererHeartbeat.mock.calls.length;
    heartbeats[0]();
    await Promise.resolve();
    expect(mocks.api.mcpRendererHeartbeat).toHaveBeenCalledTimes(callsBeforeStaleHeartbeat);

    vi.unstubAllGlobals();
  });
});
