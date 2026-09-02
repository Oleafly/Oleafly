import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setFocus: vi.fn() }),
}));

import {
  cancelQuitFlush,
  checkpointDelete,
  checkpointExport,
  checkpointFiles,
  checkpointIgnorePath,
  checkpointImport,
  checkpointInspect,
  checkpointKeepLatest,
  checkpointList,
  checkpointReset,
  checkpointRestore,
  checkpointRevealStore,
  checkpointUnignorePath,
  checkpointStats,
  checkpointVerify,
  confirmQuitFlush,
  createFile,
  detectBrowserCookieSources,
  gitInitialize,
  gitIsInitialized,
  gitPreparePublish,
  importDocument,
  importBrowserCookies,
  isFileConflictError,
  mcpAgentToolCall,
  mcpAgentToolAuthorize,
  mcpAgentToolsList,
  mcpImportSource,
  mcpServerAdd,
  mcpServerRemove,
  mcpServerSetEnabled,
  mcpServersList,
  mcpServerUpdate,
  mcpServerUpdateValidated,
  mcpServerValidate,
  renameFile,
  setCheckpointPolicy,
  validateCompileFingerprint,
} from "./tauri";

beforeEach(() => {
  mocks.invoke.mockReset();
});

describe("createFile bridge", () => {
  it("returns the created path and generation", async () => {
    mocks.invoke.mockResolvedValue({ status: "created", path: "notes (2).tex", generation: 4 });

    const result = await createFile("project", "notes.tex", false, "keep_both");

    expect(result).toEqual({ path: "notes (2).tex", generation: 4 });
    expect(mocks.invoke).toHaveBeenCalledWith("create_file", {
      projectId: "project",
      path: "notes.tex",
      isDir: false,
      conflictStrategy: "keep_both",
      expectedGeneration: undefined,
    });
  });

  it("raises a structured conflict error carrying the suggestion", async () => {
    mocks.invoke.mockResolvedValue({
      status: "conflict",
      destination: "notes.tex",
      suggested_destination: "notes (2).tex",
      generation: 0,
    });

    const failure = await createFile("project", "notes.tex", false).catch((error) => error);

    expect(isFileConflictError(failure)).toBe(true);
    expect(failure.suggestedDestination).toBe("notes (2).tex");
  });
});

describe("renameFile bridge", () => {
  it("raises the same conflict error shape as create", async () => {
    mocks.invoke.mockResolvedValue({
      status: "conflict",
      destination: "b.tex",
      suggested_destination: "b (2).tex",
      generation: 0,
    });

    const failure = await renameFile("project", "a.tex", "b.tex").catch((error) => error);

    expect(isFileConflictError(failure)).toBe(true);
  });
});

describe("quit and fingerprint bridges", () => {
  it("passes the restart intent through confirm_quit_flush", async () => {
    mocks.invoke.mockResolvedValue(undefined);
    await confirmQuitFlush(true);
    expect(mocks.invoke).toHaveBeenCalledWith("confirm_quit_flush", { restart: true });

    await cancelQuitFlush();
    expect(mocks.invoke).toHaveBeenCalledWith("cancel_quit_flush");
  });

  it("forwards fingerprint validation and returns null verbatim", async () => {
    mocks.invoke.mockResolvedValue(null);
    await expect(validateCompileFingerprint("project", "main.tex")).resolves.toBeNull();
    expect(mocks.invoke).toHaveBeenCalledWith("validate_compile_fingerprint", {
      projectId: "project",
      mainDoc: "main.tex",
    });
  });
});

describe("document import bridge", () => {
  it("passes the selected document path to the native converter", async () => {
    mocks.invoke.mockResolvedValue("converted-project");

    await expect(importDocument("/tmp/paper.md")).resolves.toBe(
      "converted-project",
    );
    expect(mocks.invoke).toHaveBeenCalledWith("import_document", {
      path: "/tmp/paper.md",
    });
  });
});

describe("browser cookie import bridge", () => {
  it("uses the dedicated detection command", async () => {
    mocks.invoke.mockResolvedValue([]);
    await detectBrowserCookieSources();

    expect(mocks.invoke).toHaveBeenCalledWith("detect_browser_cookie_sources");
  });

  it("carries the reviewed confirmation to the native boundary", async () => {
    mocks.invoke.mockResolvedValue({
      imported: 4,
      browserName: "Google Chrome",
      profileName: "Default",
      domain: "example.com",
    });
    await importBrowserCookies({
      browser: "chrome",
      profile: "Default",
      domain: "example.com",
    });

    expect(mocks.invoke).toHaveBeenCalledWith("import_browser_cookies", {
      request: {
        browser: "chrome",
        profile: "Default",
        domain: "example.com",
        confirmed: true,
      },
    });
  });
});

describe("Checkpoints bridge", () => {
  it("routes reads, verification, and restore through the shared desktop port", async () => {
    mocks.invoke.mockResolvedValue(undefined);

    await checkpointList("project");
    expect(mocks.invoke).toHaveBeenLastCalledWith("checkpoint_list", {
      projectId: "project",
    });

    await checkpointStats("project");
    expect(mocks.invoke).toHaveBeenLastCalledWith("checkpoint_stats", {
      projectId: "project",
    });

    await checkpointVerify("project");
    expect(mocks.invoke).toHaveBeenLastCalledWith("checkpoint_verify", {
      projectId: "project",
    });

    await checkpointRestore("project", "root-1", 42);
    expect(mocks.invoke).toHaveBeenLastCalledWith("checkpoint_restore", {
      projectId: "project",
      snapshotRoot: "root-1",
      expectedGeneration: 42,
    });
  });

  it("routes retention and encrypted archives through their native handlers", async () => {
    mocks.invoke.mockResolvedValue(undefined);

    await checkpointDelete("project", "root-1");
    expect(mocks.invoke).toHaveBeenLastCalledWith("checkpoint_delete", {
      projectId: "project",
      snapshotRoot: "root-1",
    });

    await checkpointKeepLatest("project");
    expect(mocks.invoke).toHaveBeenLastCalledWith("checkpoint_keep_latest", {
      projectId: "project",
    });

    await checkpointReset("project");
    expect(mocks.invoke).toHaveBeenLastCalledWith("checkpoint_reset", {
      projectId: "project",
    });

    await checkpointExport("project", "/tmp/history.checkpoints", "password");
    expect(mocks.invoke).toHaveBeenLastCalledWith("checkpoint_export", {
      projectId: "project",
      dest: "/tmp/history.checkpoints",
      password: "password",
    });

    await checkpointImport("project", "/tmp/history.checkpoints", "password");
    expect(mocks.invoke).toHaveBeenLastCalledWith("checkpoint_import", {
      projectId: "project",
      source: "/tmp/history.checkpoints",
      password: "password",
    });
  });

  it("routes the portable project policy through its native handler", async () => {
    mocks.invoke.mockResolvedValue(undefined);
    const policy = {
      mode: "engine_dependencies" as const,
      always_include: ["figures/*.png"],
      ignored: ["scratch/**"],
    };

    await setCheckpointPolicy("project", policy);
    expect(mocks.invoke).toHaveBeenLastCalledWith("set_checkpoint_policy", {
      projectId: "project",
      policy,
    });
  });

  it("routes inspection, file listing, reveal, and per-file ignore changes", async () => {
    mocks.invoke.mockResolvedValue(undefined);

    await checkpointFiles("project", "root-1");
    expect(mocks.invoke).toHaveBeenLastCalledWith("checkpoint_files", {
      projectId: "project",
      snapshotRoot: "root-1",
    });

    await checkpointInspect("project");
    expect(mocks.invoke).toHaveBeenLastCalledWith("checkpoint_inspect", {
      projectId: "project",
    });

    await checkpointRevealStore("project");
    expect(mocks.invoke).toHaveBeenLastCalledWith("checkpoint_reveal_store", {
      projectId: "project",
    });

    await checkpointIgnorePath("project", "scratch/notes.txt");
    expect(mocks.invoke).toHaveBeenLastCalledWith("checkpoint_ignore_path", {
      projectId: "project",
      path: "scratch/notes.txt",
    });

    await checkpointUnignorePath("project", "scratch/notes.txt");
    expect(mocks.invoke).toHaveBeenLastCalledWith("checkpoint_unignore_path", {
      projectId: "project",
      path: "scratch/notes.txt",
    });
  });
});

describe("explicit Git setup bridge", () => {
  it("routes observation, initialization, and publish preparation separately", async () => {
    mocks.invoke.mockResolvedValue(undefined);

    await gitIsInitialized("project");
    expect(mocks.invoke).toHaveBeenLastCalledWith("git_is_initialized", {
      projectId: "project",
    });

    await gitInitialize("project");
    expect(mocks.invoke).toHaveBeenLastCalledWith("git_initialize", {
      projectId: "project",
    });

    await gitPreparePublish("project", "Initial commit");
    expect(mocks.invoke).toHaveBeenLastCalledWith("git_prepare_publish", {
      projectId: "project",
      message: "Initial commit",
    });
  });
});

describe("MCP server management bridge", () => {
  const server = {
    name: "filesystem",
    enabled: true,
    transport: "stdio" as const,
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/docs"],
    env: { NODE_ENV: "production" },
  };

  it("requests read-only server candidates for one supported source", async () => {
    mocks.invoke.mockResolvedValue([]);

    await mcpImportSource("cursor");

    expect(mocks.invoke).toHaveBeenLastCalledWith("mcp_import_source", {
      sourceTool: "cursor",
    });
  });

  it("uses the dedicated list, add, and update commands", async () => {
    mocks.invoke.mockResolvedValue({
      config: server,
      validation: {
        name: server.name,
        status: "connected",
        tool_count: 1,
        tools: [{ name: "read_file", description: "Read a file" }],
        error: null,
      },
    });

    await mcpServersList();
    expect(mocks.invoke).toHaveBeenLastCalledWith("mcp_servers_list");

    await mcpServerAdd(server);
    expect(mocks.invoke).toHaveBeenLastCalledWith("mcp_server_add", { server });

    await mcpServerUpdate("old-filesystem", server);
    expect(mocks.invoke).toHaveBeenLastCalledWith("mcp_server_update", {
      originalName: "old-filesystem",
      server,
    });

    await mcpServerUpdateValidated("old-filesystem", server);
    expect(mocks.invoke).toHaveBeenLastCalledWith("mcp_server_update_validated", {
      originalName: "old-filesystem",
      server,
    });
  });

  it("uses server names for validate, enable, and remove commands", async () => {
    mocks.invoke.mockResolvedValue(undefined);

    await mcpServerValidate("filesystem");
    expect(mocks.invoke).toHaveBeenLastCalledWith("mcp_server_validate", {
      name: "filesystem",
    });

    await mcpServerSetEnabled("filesystem", false);
    expect(mocks.invoke).toHaveBeenLastCalledWith("mcp_server_set_enabled", {
      name: "filesystem",
      enabled: false,
    });

    await mcpServerRemove("filesystem");
    expect(mocks.invoke).toHaveBeenLastCalledWith("mcp_server_remove", {
      name: "filesystem",
    });
  });

  it("lists, authorizes, and calls a discovered raw agent tool handle", async () => {
    mocks.invoke.mockResolvedValue(undefined);

    await mcpAgentToolsList();
    expect(mocks.invoke).toHaveBeenLastCalledWith("mcp_agent_tools_list");

    await mcpAgentToolAuthorize(
      "project-1",
      "filesystem",
      "read_file",
      { path: "paper.tex" },
      "run-1",
    );
    expect(mocks.invoke).toHaveBeenLastCalledWith("mcp_agent_tool_authorize", {
      projectId: "project-1",
      server: "filesystem",
      toolHandle: "read_file",
      arguments: { path: "paper.tex" },
      runId: "run-1",
    });

    await mcpAgentToolCall(
      "project-1",
      "filesystem",
      "read_file",
      { path: "paper.tex" },
      "run-1",
      "approval-1",
    );
    expect(mocks.invoke).toHaveBeenLastCalledWith("mcp_agent_tool_call", {
      projectId: "project-1",
      server: "filesystem",
      toolHandle: "read_file",
      arguments: { path: "paper.tex" },
      runId: "run-1",
      approvalToken: "approval-1",
    });
  });
});
