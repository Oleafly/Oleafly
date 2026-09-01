import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfirmFn, ToolApprovalRequest } from "@/lib/ai-tools";
import type { McpAgentServer } from "@/lib/tauri";
import { mcpAgentToolAuthorize, mcpAgentToolCall } from "@/lib/tauri";
import { createMcpRuntimeToolsets } from "./mcp-agent-tools";

vi.mock("@/lib/tauri", () => ({
  mcpAgentToolsList: vi.fn(),
  mcpAgentToolAuthorize: vi.fn(),
  mcpAgentToolCall: vi.fn(),
}));

const SERVERS: McpAgentServer[] = [
  {
    name: "Papers",
    tools: [
      {
        name: "mcp__papers__search_papers",
        tool_handle: "search_papers",
        description: "Search the connected papers server.",
        input_schema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
    ],
  },
];

describe("Assistant MCP tool adapter", () => {
  const call = vi.mocked(mcpAgentToolCall);
  const authorize = vi.mocked(mcpAgentToolAuthorize);

  beforeEach(() => {
    authorize.mockReset().mockResolvedValue("approval-1");
    call.mockReset();
  });

  it("creates a grouped runtime toolset from backend-discovered schemas", () => {
    const toolsets = createMcpRuntimeToolsets(SERVERS, {
      confirm: vi.fn(async () => true),
      onImage: vi.fn(),
      projectId: () => "project-1",
      runId: () => "run-1",
      isActive: () => true,
    });

    expect(toolsets).toHaveLength(1);
    expect(toolsets[0]).toMatchObject({
      id: "mcp:Papers",
      source: { kind: "mcp", server: "Papers" },
    });
    expect(toolsets[0].tools.mcp__papers__search_papers).toMatchObject({
      description: "Search the connected papers server.",
      inputSchema: SERVERS[0].tools[0].input_schema,
    });
  });

  it("requires approval and calls the authoritative server and raw tool handle", async () => {
    const confirm = vi.fn(async () => true);
    call.mockResolvedValue({ content: [{ type: "text", text: "Found it" }] });
    const tool = createMcpRuntimeToolsets(SERVERS, {
      confirm,
      onImage: vi.fn(),
      projectId: () => "project-1",
      runId: () => "run-1",
      isActive: () => true,
    })[0].tools.mcp__papers__search_papers;

    await expect(tool.execute?.({ query: "tool managers" })).resolves.toEqual({
      content: [{ type: "text", text: "Found it" }],
    });
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: "mcp__papers__search_papers",
        summary: "Use search_papers from the Papers MCP server",
        mcp: {
          server: "Papers",
          tool: "search_papers",
          argumentsPreview: '{\n  "query": "tool managers"\n}',
        },
      }),
    );
    expect(authorize).toHaveBeenCalledWith(
      "project-1",
      "Papers",
      "search_papers",
      { query: "tool managers" },
      "run-1",
    );
    expect(call).toHaveBeenCalledWith(
      "project-1",
      "Papers",
      "search_papers",
      { query: "tool managers" },
      "run-1",
      "approval-1",
    );
    expect(confirm.mock.invocationCallOrder[0]).toBeLessThan(
      authorize.mock.invocationCallOrder[0],
    );
    expect(authorize.mock.invocationCallOrder[0]).toBeLessThan(
      call.mock.invocationCallOrder[0],
    );
  });

  it("redacts credentials and bounds the approval argument preview", async () => {
    const confirm = vi.fn<ConfirmFn>(async () => true);
    call.mockResolvedValue({ content: [{ type: "text", text: "Found it" }] });
    const tool = createMcpRuntimeToolsets(SERVERS, {
      confirm,
      onImage: vi.fn(),
      projectId: () => "project-1",
      runId: () => "run-1",
      isActive: () => true,
    })[0].tools.mcp__papers__search_papers;

    await tool.execute?.({
      query: "tool managers",
      apiToken: "token-that-must-not-render",
      nested: {
        password: "password-that-must-not-render",
        deeper: { value: { value: { value: "too deep" } } },
      },
      longValue: "x".repeat(2_000),
    });

    const request = confirm.mock.calls.at(0)?.[0];
    if (!request) throw new Error("Expected an MCP approval request.");
    const preview = (
      request as ToolApprovalRequest & {
        mcp: { argumentsPreview: string };
      }
    ).mcp.argumentsPreview;
    expect(preview).toContain("[redacted]");
    expect(preview).toContain("[truncated]");
    expect(preview).not.toContain("token-that-must-not-render");
    expect(preview).not.toContain("password-that-must-not-render");
    expect(preview.length).toBeLessThanOrEqual(1_200);
  });

  it("does not call a rejected or inactive MCP tool", async () => {
    const inactiveConfirm = vi.fn(async () => true);
    const rejected = createMcpRuntimeToolsets(SERVERS, {
      confirm: vi.fn(async () => false),
      onImage: vi.fn(),
      projectId: () => "project-1",
      runId: () => "run-1",
      isActive: () => true,
    })[0].tools.mcp__papers__search_papers;
    const inactive = createMcpRuntimeToolsets(SERVERS, {
      confirm: inactiveConfirm,
      onImage: vi.fn(),
      projectId: () => null,
      runId: () => "run-1",
      isActive: () => true,
    })[0].tools.mcp__papers__search_papers;

    await expect(rejected.execute?.({})).resolves.toEqual({
      error: "MCP tool call was not approved.",
    });
    await expect(inactive.execute?.({})).resolves.toEqual({
      error: "MCP tool call is no longer active.",
    });
    expect(inactiveConfirm).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });

  it("does not call the server when the active run changes during approval", async () => {
    let activeRun = "run-1";
    const tool = createMcpRuntimeToolsets(SERVERS, {
      confirm: vi.fn(async () => {
        activeRun = "run-2";
        return true;
      }),
      onImage: vi.fn(),
      projectId: () => "project-1",
      runId: () => activeRun,
      isActive: () => true,
    })[0].tools.mcp__papers__search_papers;

    await expect(tool.execute?.({ query: "late" })).resolves.toEqual({
      error: "MCP tool call is no longer active.",
    });
    expect(call).not.toHaveBeenCalled();
  });

  it("does not call the server when backend authorization fails", async () => {
    authorize.mockRejectedValue(new Error("Authorization failed"));
    const tool = createMcpRuntimeToolsets(SERVERS, {
      confirm: vi.fn(async () => true),
      onImage: vi.fn(),
      projectId: () => "project-1",
      runId: () => "run-1",
      isActive: () => true,
    })[0].tools.mcp__papers__search_papers;

    await expect(tool.execute?.({ query: "blocked" })).rejects.toThrow(
      "Authorization failed",
    );
    expect(call).not.toHaveBeenCalled();
  });

  it("does not call the server when the run changes after backend authorization", async () => {
    let activeRun = "run-1";
    authorize.mockImplementation(async () => {
      activeRun = "run-2";
      return "approval-late";
    });
    const tool = createMcpRuntimeToolsets(SERVERS, {
      confirm: vi.fn(async () => true),
      onImage: vi.fn(),
      projectId: () => "project-1",
      runId: () => activeRun,
      isActive: () => true,
    })[0].tools.mcp__papers__search_papers;

    await expect(tool.execute?.({ query: "late" })).resolves.toEqual({
      error: "MCP tool call is no longer active.",
    });
    expect(call).not.toHaveBeenCalled();
  });

  it("discards late text and images when the active run changes during the call", async () => {
    let activeRun = "run-1";
    let resolveCall: ((value: unknown) => void) | undefined;
    call.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCall = resolve;
        }),
    );
    const onImage = vi.fn();
    const tool = createMcpRuntimeToolsets(SERVERS, {
      confirm: vi.fn(async () => true),
      onImage,
      projectId: () => "project-1",
      runId: () => activeRun,
      isActive: () => true,
    })[0].tools.mcp__papers__search_papers;

    const pending = tool.execute?.({ query: "late" });
    await vi.waitFor(() => expect(call).toHaveBeenCalledOnce());
    activeRun = "run-2";
    resolveCall?.({
      content: [
        { type: "text", text: "Stale result" },
        { type: "image", mimeType: "image/png", data: "TEFURQ==" },
      ],
    });

    await expect(pending).resolves.toEqual({
      error: "MCP tool call is no longer active.",
    });
    expect(onImage).not.toHaveBeenCalled();
  });

  it("discards late text and images when the run is aborted during the call", async () => {
    let active = true;
    let resolveCall: ((value: unknown) => void) | undefined;
    call.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCall = resolve;
        }),
    );
    const onImage = vi.fn();
    const tool = createMcpRuntimeToolsets(SERVERS, {
      confirm: vi.fn(async () => true),
      onImage,
      projectId: () => "project-1",
      runId: () => "run-1",
      isActive: () => active,
    })[0].tools.mcp__papers__search_papers;

    const pending = tool.execute?.({ query: "late" });
    await vi.waitFor(() => expect(call).toHaveBeenCalledOnce());
    active = false;
    resolveCall?.({
      content: [
        { type: "text", text: "Aborted result" },
        { type: "image", mimeType: "image/png", data: "QUJPUlRFRA==" },
      ],
    });

    await expect(pending).resolves.toEqual({
      error: "MCP tool call is no longer active.",
    });
    expect(onImage).not.toHaveBeenCalled();
  });

  it("routes image content to the run without returning base64 to the model", async () => {
    const onImage = vi.fn();
    call.mockResolvedValue({
      content: [
        { type: "text", text: "Chart ready" },
        { type: "image", mimeType: "image/png", data: "QUJD" },
      ],
      structuredContent: { rows: 2 },
    });
    const tool = createMcpRuntimeToolsets(SERVERS, {
      confirm: vi.fn(async () => true),
      onImage,
      projectId: () => "project-1",
      runId: () => "run-1",
      isActive: () => true,
    })[0].tools.mcp__papers__search_papers;

    await expect(tool.execute?.({ query: "chart" })).resolves.toEqual({
      content: [
        { type: "text", text: "Chart ready" },
        { type: "text", text: "The MCP server returned an image." },
      ],
      structuredContent: { rows: 2 },
    });
    expect(onImage).toHaveBeenCalledWith("data:image/png;base64,QUJD");
  });

  it("does not queue unsupported image output or text-only output", async () => {
    const onImage = vi.fn();
    call
      .mockResolvedValueOnce({
        content: [
          { type: "text", text: "Vector result" },
          { type: "image", mimeType: "image/svg+xml", data: "PHN2Zy8+" },
        ],
      })
      .mockResolvedValueOnce({
        content: [{ type: "text", text: "Text only" }],
      });
    const tool = createMcpRuntimeToolsets(SERVERS, {
      confirm: vi.fn(async () => true),
      onImage,
      projectId: () => "project-1",
      runId: () => "run-1",
      isActive: () => true,
    })[0].tools.mcp__papers__search_papers;

    await expect(tool.execute?.({ query: "vector" })).resolves.toEqual({
      content: [
        { type: "text", text: "Vector result" },
        { type: "text", text: "The MCP server returned an image." },
      ],
    });
    await expect(tool.execute?.({ query: "text" })).resolves.toEqual({
      content: [{ type: "text", text: "Text only" }],
    });
    expect(onImage).not.toHaveBeenCalled();
  });
});
