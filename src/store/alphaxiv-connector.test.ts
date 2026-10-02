import { describe, it, expect, vi, beforeEach } from "vitest";
import type { McpManagedServer, McpServerConfig } from "@oleafly/backend-port";

const mocks = vi.hoisted(() => ({
  getConnectorKey: vi.fn(),
  setConnectorKey: vi.fn(),
  mcpServersList: vi.fn(),
  mcpServerAdd: vi.fn(),
  mcpServerUpdateValidated: vi.fn(),
  mcpServerRemove: vi.fn(),
  notifyMcpAgentToolsChanged: vi.fn(),
  logError: vi.fn(),
}));
vi.mock("@/lib/tauri", () => ({
  getConnectorKey: mocks.getConnectorKey,
  setConnectorKey: mocks.setConnectorKey,
  mcpServersList: mocks.mcpServersList,
  mcpServerAdd: mocks.mcpServerAdd,
  mcpServerUpdateValidated: mocks.mcpServerUpdateValidated,
  mcpServerRemove: mocks.mcpServerRemove,
}));
vi.mock("@/lib/mcp-agent-tools", () => ({
  notifyMcpAgentToolsChanged: mocks.notifyMcpAgentToolsChanged,
}));
vi.mock("@/lib/log", () => ({ logError: mocks.logError }));

import {
  ALPHAXIV_MCP_URL,
  ALPHAXIV_SERVER_NAME,
  useAlphaXivConnectorStore,
} from "./alphaxiv-connector";

function managed(config: McpServerConfig): McpManagedServer {
  return {
    config,
    validation: { name: config.name, status: "connected", tools: [], error: null },
  } as unknown as McpManagedServer;
}

function alphaXivServer(name = ALPHAXIV_SERVER_NAME, url = ALPHAXIV_MCP_URL): McpManagedServer {
  return managed({ name, enabled: true, transport: "remote", url, headers: {} });
}

const expectedConfig = (key: string, name = ALPHAXIV_SERVER_NAME) => ({
  name,
  enabled: true,
  transport: "remote",
  url: "https://api.alphaxiv.org/mcp/v1",
  headers: { Authorization: `Bearer ${key}` },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConnectorKey.mockResolvedValue(null);
  mocks.setConnectorKey.mockResolvedValue(undefined);
  mocks.mcpServersList.mockResolvedValue([]);
  mocks.mcpServerAdd.mockImplementation(async (config: McpServerConfig) => managed(config));
  mocks.mcpServerUpdateValidated.mockImplementation(async (_name: string, config: McpServerConfig) =>
    managed(config),
  );
  mocks.mcpServerRemove.mockResolvedValue(undefined);
  useAlphaXivConnectorStore.setState({
    connected: false,
    loading: false,
    failure: null,
    serverName: null,
  });
});

describe("alphaXiv connector store", () => {
  it("reports connected when alphaXiv's MCP server is registered", async () => {
    mocks.mcpServersList.mockResolvedValue([alphaXivServer("my-alphaxiv", `${ALPHAXIV_MCP_URL}/`)]);
    await useAlphaXivConnectorStore.getState().refresh();
    expect(useAlphaXivConnectorStore.getState()).toMatchObject({
      connected: true,
      serverName: "my-alphaxiv",
    });
    expect(mocks.mcpServerAdd).not.toHaveBeenCalled();
  });

  it("reports not connected when no alphaXiv server exists", async () => {
    await useAlphaXivConnectorStore.getState().refresh();
    expect(useAlphaXivConnectorStore.getState().connected).toBe(false);
  });

  it("moves a key saved by the old integration onto the MCP server once", async () => {
    mocks.getConnectorKey.mockResolvedValue(" old-key ");
    await useAlphaXivConnectorStore.getState().refresh();
    expect(mocks.setConnectorKey).toHaveBeenCalledWith("alphaxiv", "");
    expect(mocks.mcpServerAdd).toHaveBeenCalledWith(expectedConfig("old-key"));
    expect(mocks.notifyMcpAgentToolsChanged).toHaveBeenCalledTimes(1);
    expect(useAlphaXivConnectorStore.getState().connected).toBe(true);
  });

  it("drops an old key that alphaXiv no longer accepts and stays disconnected", async () => {
    mocks.getConnectorKey.mockResolvedValue("old-key");
    mocks.mcpServerAdd.mockRejectedValue(new Error("HTTP 401"));
    await useAlphaXivConnectorStore.getState().refresh();
    expect(mocks.setConnectorKey).toHaveBeenCalledWith("alphaxiv", "");
    expect(useAlphaXivConnectorStore.getState()).toMatchObject({ connected: false, failure: null });
  });

  it("connects by adding alphaXiv's MCP server with the key as a bearer header", async () => {
    const ok = await useAlphaXivConnectorStore.getState().connect("new-key");
    expect(ok).toBe(true);
    expect(mocks.mcpServerAdd).toHaveBeenCalledWith(expectedConfig("new-key"));
    expect(mocks.notifyMcpAgentToolsChanged).toHaveBeenCalledTimes(1);
    expect(useAlphaXivConnectorStore.getState()).toMatchObject({
      connected: true,
      serverName: ALPHAXIV_SERVER_NAME,
      loading: false,
    });
  });

  it("replaces the key on a server the user already added by hand, keeping its name", async () => {
    mocks.mcpServersList.mockResolvedValue([alphaXivServer("alphaxiv-manual")]);
    await useAlphaXivConnectorStore.getState().connect("new-key");
    expect(mocks.mcpServerAdd).not.toHaveBeenCalled();
    expect(mocks.mcpServerUpdateValidated).toHaveBeenCalledWith(
      "alphaxiv-manual",
      expectedConfig("new-key", "alphaxiv-manual"),
    );
  });

  it("records a failed connection without saving anything", async () => {
    mocks.mcpServerAdd.mockRejectedValue(new Error("HTTP 401"));
    const ok = await useAlphaXivConnectorStore.getState().connect("bad-key");
    expect(ok).toBe(false);
    expect(useAlphaXivConnectorStore.getState()).toMatchObject({
      connected: false,
      failure: "connect",
      loading: false,
    });
    expect(mocks.notifyMcpAgentToolsChanged).not.toHaveBeenCalled();
    expect(mocks.setConnectorKey).not.toHaveBeenCalled();
  });

  it("disconnects by removing the MCP server", async () => {
    useAlphaXivConnectorStore.setState({ connected: true, serverName: "alphaXiv" });
    await useAlphaXivConnectorStore.getState().disconnect();
    expect(mocks.mcpServerRemove).toHaveBeenCalledWith("alphaXiv");
    expect(mocks.notifyMcpAgentToolsChanged).toHaveBeenCalledTimes(1);
    expect(useAlphaXivConnectorStore.getState()).toMatchObject({
      connected: false,
      serverName: null,
    });
  });

  it("keeps the connection when removing the server fails", async () => {
    useAlphaXivConnectorStore.setState({ connected: true, serverName: "alphaXiv" });
    mocks.mcpServerRemove.mockRejectedValue(new Error("locked"));
    await useAlphaXivConnectorStore.getState().disconnect();
    expect(useAlphaXivConnectorStore.getState()).toMatchObject({
      connected: true,
      failure: "disconnect",
    });
  });
});
