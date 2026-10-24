// 0.4.8 I: Cua Spaces as an ordinary MCP server (`cua daemon mcp`). It is
// read-only and keeps the user's agent sign-ins to itself unless the user
// turns those on. Every Spaces call still asks through the MCP approval.
import { create } from "zustand";
import type { McpManagedServer, McpServerConfig } from "@oleafly/backend-port";
import { logError } from "@/lib/log";
import { notifyMcpAgentToolsChanged } from "@/lib/mcp-agent-tools";
import { mcpServerAdd, mcpServerRemove, mcpServersList, mcpServerUpdateValidated } from "@/lib/tauri";

export const CUA_SPACES_SERVER_NAME = "Cua Spaces";
const CREDENTIALS_ENV = "CUA_SPACES_AGENT_CREDENTIALS_HOME";
const READ_ONLY_ARGS = ["--permissions", "spaces:readonly"] as const;

export interface CuaSpacesOptions {
  /** Agents may also create, change and delete Spaces. */
  fullAccess: boolean;
  /** Agents started in a Space may use the user's agent sign-ins. */
  shareCredentials: boolean;
}

const DEFAULT_OPTIONS: CuaSpacesOptions = { fullAccess: false, shareCredentials: false };

export function cuaSpacesServerConfig(
  command: string,
  options: CuaSpacesOptions,
  name: string = CUA_SPACES_SERVER_NAME,
): McpServerConfig {
  return {
    name,
    enabled: true,
    transport: "stdio",
    command,
    args: ["daemon", "mcp", ...(options.fullAccess ? [] : READ_ONLY_ARGS)],
    env: options.shareCredentials ? {} : { [CREDENTIALS_ENV]: "none" },
  };
}

function programName(command: string): string {
  return (command.split(/[\\/]/).pop() ?? "").toLowerCase();
}

function isSpacesServer(server: McpManagedServer): boolean {
  const config = server.config;
  return (
    config.transport === "stdio" &&
    config.args[0] === "daemon" &&
    config.args[1] === "mcp" &&
    (programName(config.command) === "cua" || programName(config.command) === "cua.exe")
  );
}

function findSpacesServer(servers: readonly McpManagedServer[]): McpManagedServer | undefined {
  return servers.find(isSpacesServer) ?? servers.find((server) => server.config.name === CUA_SPACES_SERVER_NAME);
}

/** The switches as a listed server has them; env values may be redacted. */
export function readCuaSpacesOptions(server: McpManagedServer): CuaSpacesOptions {
  if (server.config.transport !== "stdio") return DEFAULT_OPTIONS;
  return {
    fullAccess: !server.config.args.includes(READ_ONLY_ARGS[0]),
    shareCredentials: !(CREDENTIALS_ENV in server.config.env),
  };
}

interface CuaSpacesConnectorState {
  connected: boolean;
  options: CuaSpacesOptions;
  loading: boolean;
  failed: boolean;
  serverName: string | null;
  refresh(): Promise<void>;
  connect(command: string, options: CuaSpacesOptions): Promise<boolean>;
  update(command: string, options: CuaSpacesOptions): Promise<boolean>;
  disconnect(): Promise<void>;
}

export const useCuaSpacesConnectorStore = create<CuaSpacesConnectorState>((set, get) => {
  const save = async (command: string, options: CuaSpacesOptions, action: string): Promise<boolean> => {
    set({ loading: true, failed: false });
    try {
      const existing = findSpacesServer(await mcpServersList());
      const saved = existing
        ? await mcpServerUpdateValidated(
            existing.config.name,
            cuaSpacesServerConfig(command, options, existing.config.name),
          )
        : await mcpServerAdd(cuaSpacesServerConfig(command, options));
      notifyMcpAgentToolsChanged();
      set({ connected: true, options, serverName: saved.config.name });
      return true;
    } catch (error) {
      void logError(action, error);
      set({ failed: true });
      return false;
    } finally {
      set({ loading: false });
    }
  };
  return {
    connected: false,
    options: DEFAULT_OPTIONS,
    loading: false,
    failed: false,
    serverName: null,
    refresh: async () => {
      set({ loading: true });
      try {
        const server = findSpacesServer(await mcpServersList());
        set({
          connected: Boolean(server),
          options: server ? readCuaSpacesOptions(server) : DEFAULT_OPTIONS,
          serverName: server?.config.name ?? null,
        });
      } catch (error) {
        void logError("read the Cua Spaces connection", error);
      } finally {
        set({ loading: false });
      }
    },
    connect: (command, options) => save(command, options, "connect Cua Spaces"),
    update: (command, options) => save(command, options, "update the Cua Spaces connection"),
    disconnect: async () => {
      set({ loading: true, failed: false });
      try {
        const name = get().serverName ?? findSpacesServer(await mcpServersList())?.config.name;
        if (name) await mcpServerRemove(name);
        notifyMcpAgentToolsChanged();
        set({ connected: false, serverName: null, options: DEFAULT_OPTIONS });
      } catch (error) {
        void logError("disconnect Cua Spaces", error);
        set({ failed: true });
      } finally {
        set({ loading: false });
      }
    },
  };
});
