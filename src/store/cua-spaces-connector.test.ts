import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpManagedServer, McpServerConfig } from "@oleafly/backend-port";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  add: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@/lib/tauri", () => ({
  mcpServersList: mocks.list,
  mcpServerAdd: mocks.add,
  mcpServerUpdateValidated: mocks.update,
  mcpServerRemove: mocks.remove,
}));
vi.mock("@/lib/mcp-agent-tools", () => ({ notifyMcpAgentToolsChanged: mocks.notify }));
vi.mock("@/lib/log", () => ({ logError: vi.fn(async () => undefined) }));

import {
  cuaSpacesServerConfig,
  readCuaSpacesOptions,
  useCuaSpacesConnectorStore,
} from "./cua-spaces-connector";

const COMMAND = "C:\\Users\\Zoë\\.local\\bin\\cua.exe";

function managed(config: McpServerConfig): McpManagedServer {
  return {
    config,
    validation: { name: config.name, status: "connected", tool_count: 0, tools: [], error: null },
  };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  useCuaSpacesConnectorStore.setState({
    connected: false,
    loading: false,
    failed: false,
    serverName: null,
    options: { fullAccess: false, shareCredentials: false },
  });
});

describe("Cua Spaces connector", () => {
  it("connects read-only without sharing sign-ins by default", () => {
    expect(cuaSpacesServerConfig(COMMAND, { fullAccess: false, shareCredentials: false })).toEqual({
      name: "Cua Spaces",
      enabled: true,
      transport: "stdio",
      command: COMMAND,
      args: ["daemon", "mcp", "--permissions", "spaces:readonly"],
      env: { CUA_SPACES_AGENT_CREDENTIALS_HOME: "none" },
    });
  });

  it("full access drops the permission flag and sharing drops the env", () => {
    expect(cuaSpacesServerConfig(COMMAND, { fullAccess: true, shareCredentials: true }, "Spaces")).toEqual({
      name: "Spaces",
      enabled: true,
      transport: "stdio",
      command: COMMAND,
      args: ["daemon", "mcp"],
      env: {},
    });
  });

  it("reads the switches back from a listed server with redacted env values", () => {
    const listed = managed({
      ...cuaSpacesServerConfig("/home/a/.local/bin/cua", { fullAccess: false, shareCredentials: false }),
      env: { CUA_SPACES_AGENT_CREDENTIALS_HOME: "[stored]" },
    } as McpServerConfig);
    expect(readCuaSpacesOptions(listed)).toEqual({ fullAccess: false, shareCredentials: false });
    const open = managed(cuaSpacesServerConfig("/usr/local/bin/cua", { fullAccess: true, shareCredentials: true }));
    expect(readCuaSpacesOptions(open)).toEqual({ fullAccess: true, shareCredentials: true });
  });

  it("connect adds, update keeps the name, disconnect removes and notifies the assistant", async () => {
    const options = { fullAccess: false, shareCredentials: false };
    mocks.list.mockResolvedValueOnce([]);
    mocks.add.mockImplementation(async (config: McpServerConfig) => managed(config));
    await expect(useCuaSpacesConnectorStore.getState().connect(COMMAND, options)).resolves.toBe(true);
    expect(mocks.add).toHaveBeenCalledWith(cuaSpacesServerConfig(COMMAND, options));
    expect(useCuaSpacesConnectorStore.getState()).toMatchObject({ connected: true, serverName: "Cua Spaces" });

    const existing = managed(cuaSpacesServerConfig(COMMAND, options, "My Spaces"));
    mocks.list.mockResolvedValueOnce([existing]);
    mocks.update.mockImplementation(async (_name: string, config: McpServerConfig) => managed(config));
    const wider = { fullAccess: true, shareCredentials: false };
    await expect(useCuaSpacesConnectorStore.getState().update(COMMAND, wider)).resolves.toBe(true);
    expect(mocks.update).toHaveBeenCalledWith("My Spaces", cuaSpacesServerConfig(COMMAND, wider, "My Spaces"));
    expect(useCuaSpacesConnectorStore.getState().options).toEqual(wider);

    await useCuaSpacesConnectorStore.getState().disconnect();
    expect(mocks.remove).toHaveBeenCalledWith("My Spaces");
    expect(useCuaSpacesConnectorStore.getState().connected).toBe(false);
    expect(mocks.notify).toHaveBeenCalledTimes(3);
  });

  it("reports a failed connection without claiming it is connected", async () => {
    mocks.list.mockResolvedValueOnce([]);
    mocks.add.mockRejectedValueOnce(new Error("cua not found"));
    await expect(
      useCuaSpacesConnectorStore.getState().connect(COMMAND, { fullAccess: false, shareCredentials: false }),
    ).resolves.toBe(false);
    expect(useCuaSpacesConnectorStore.getState()).toMatchObject({ connected: false, failed: true, loading: false });
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("finds an existing server by its command and arguments", async () => {
    mocks.list.mockResolvedValueOnce([
      managed({ name: "other", enabled: true, transport: "remote", url: "https://x", headers: {} }),
      managed(cuaSpacesServerConfig("/opt/cua/bin/cua", { fullAccess: true, shareCredentials: false }, "renamed")),
    ]);
    await useCuaSpacesConnectorStore.getState().refresh();
    expect(useCuaSpacesConnectorStore.getState()).toMatchObject({
      connected: true,
      serverName: "renamed",
      options: { fullAccess: true, shareCredentials: false },
    });
  });
});
