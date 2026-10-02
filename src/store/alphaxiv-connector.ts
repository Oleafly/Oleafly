import { create } from "zustand";
import type { McpManagedServer, McpServerConfig } from "@oleafly/backend-port";
import { logError } from "@/lib/log";
import { notifyMcpAgentToolsChanged } from "@/lib/mcp-agent-tools";
import {
  getConnectorKey,
  mcpServerAdd,
  mcpServerRemove,
  mcpServersList,
  mcpServerUpdateValidated,
  setConnectorKey,
} from "@/lib/tauri";

export const ALPHAXIV_MCP_URL = "https://api.alphaxiv.org/mcp/v1";
export const ALPHAXIV_SERVER_NAME = "alphaXiv";
const LEGACY_CONNECTOR_KEY = "alphaxiv";

export type AlphaXivFailure = "connect" | "disconnect" | null;

interface AlphaXivConnectorState {
  connected: boolean;
  loading: boolean;
  failure: AlphaXivFailure;
  serverName: string | null;
  connect(apiKey: string): Promise<boolean>;
  disconnect(): Promise<void>;
  refresh(): Promise<void>;
}

function alphaXivServerConfig(apiKey: string, name = ALPHAXIV_SERVER_NAME): McpServerConfig {
  return {
    name,
    enabled: true,
    transport: "remote",
    url: ALPHAXIV_MCP_URL,
    headers: { Authorization: `Bearer ${apiKey}` },
  };
}

function findAlphaXivServer(servers: readonly McpManagedServer[]): McpManagedServer | undefined {
  return (
    servers.find(
      (server) =>
        server.config.transport === "remote" &&
        server.config.url.replace(/\/+$/u, "") === ALPHAXIV_MCP_URL,
    ) ?? servers.find((server) => server.config.name === ALPHAXIV_SERVER_NAME)
  );
}

async function adoptLegacyKey(): Promise<McpManagedServer | null> {
  const legacy = (await getConnectorKey(LEGACY_CONNECTOR_KEY))?.trim();
  if (!legacy) return null;
  await setConnectorKey(LEGACY_CONNECTOR_KEY, "");
  try {
    return await mcpServerAdd(alphaXivServerConfig(legacy));
  } catch (error) {
    void logError("move the saved alphaXiv key to its MCP server", error);
    return null;
  }
}

export const useAlphaXivConnectorStore = create<AlphaXivConnectorState>((set, get) => ({
  connected: false,
  loading: false,
  failure: null,
  serverName: null,
  refresh: async () => {
    set({ loading: true });
    try {
      const existing = findAlphaXivServer(await mcpServersList());
      const server = existing ?? (await adoptLegacyKey());
      if (server && !existing) notifyMcpAgentToolsChanged();
      set({ connected: Boolean(server), serverName: server?.config.name ?? null });
    } catch (error) {
      void logError("read the alphaXiv connection", error);
    } finally {
      set({ loading: false });
    }
  },
  connect: async (apiKey: string) => {
    set({ loading: true, failure: null });
    try {
      const existing = findAlphaXivServer(await mcpServersList());
      const saved = existing
        ? await mcpServerUpdateValidated(
            existing.config.name,
            alphaXivServerConfig(apiKey, existing.config.name),
          )
        : await mcpServerAdd(alphaXivServerConfig(apiKey));
      notifyMcpAgentToolsChanged();
      set({ connected: true, serverName: saved.config.name });
      return true;
    } catch (error) {
      void logError("connect alphaXiv", error);
      set({ failure: "connect" });
      return false;
    } finally {
      set({ loading: false });
    }
  },
  disconnect: async () => {
    set({ loading: true, failure: null });
    try {
      const name = get().serverName ?? findAlphaXivServer(await mcpServersList())?.config.name;
      if (name) await mcpServerRemove(name);
      notifyMcpAgentToolsChanged();
      set({ connected: false, serverName: null });
    } catch (error) {
      void logError("disconnect alphaXiv", error);
      set({ failure: "disconnect" });
    } finally {
      set({ loading: false });
    }
  },
}));
