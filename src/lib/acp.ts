import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface AcpPackageDistribution {
  package: string;
  cmd?: string | null;
  args?: string[];
  nodeMajor?: number | null;
  env?: Record<string, string>;
}
export interface AcpDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  builtin: boolean;
  distribution: {
    npx?: AcpPackageDistribution | null;
    uvx?: AcpPackageDistribution | null;
    binary?: Record<string, { archive: string; cmd: string; sha256?: string | null; args?: string[] }>;
    command?: { executable: string; args?: string[] } | null;
  };
}
export interface AcpAgentStatus {
  definition: AcpDefinition;
  platform: string;
  installed: boolean;
  executable: string | null;
  installedVersion: string | null;
  managed: boolean;
  canInstall: boolean;
  reason: string | null;
  signInHint: string | null;
  taskUnavailableReason: string | null;
}
export interface AcpRegistryEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  definition: AcpDefinition | null;
  reason: string | null;
}
export type AcpSessionStatus = "connecting" | "auth_required" | "ready" | "running" | "cancelling" | "cancelled" | "disconnected" | "failed";
export interface AcpSession {
  id: string;
  projectId: string;
  projectPath: string;
  agentId: string;
  agentVersion: string | null;
  nativeSessionId: string | null;
  parentSessionId: string | null;
  taskId: string | null;
  title: string;
  status: AcpSessionStatus;
  createdAt: number;
  updatedAt: number;
  turnId: string | null;
  capabilities: {
    loadSession: boolean;
    resume: boolean;
    image: boolean;
    audio: boolean;
    embeddedContext: boolean;
    additionalDirectories: boolean;
    mcpHttp: boolean;
  };
  controls: {
    models: { modelId: string; name: string }[];
    modelId: string | null;
    modelConfigId: string | null;
  };
  authMethods: { id: string; name: string; description: string | null }[];
  error: string | null;
  lastSequence: number;
}
export interface AcpPermission {
  id: string;
  sessionId: string;
  turnId: string;
  title: string;
  toolCallId: string | null;
  options: { optionId: string; name: string; kind: string }[];
  expiresAt: number;
}
export interface AcpSnapshot { session: AcpSession; permissions: AcpPermission[] }
export interface AcpEvent {
  sessionId: string;
  projectId: string;
  agentId: string;
  modelId: string | null;
  taskId: string | null;
  turnId: string | null;
  sequence: number;
  timestamp: number;
  kind: string;
  data: Record<string, unknown>;
}
export interface AcpEventPage { events: AcpEvent[]; hasMore: boolean }
export interface AcpImage { mimeType: string; data: string }

export const acpCatalog = (probe = false) => invoke<AcpAgentStatus[]>("acp_catalog", { probe });
export const acpRegistrySearch = (query: string) => invoke<AcpRegistryEntry[]>("acp_registry_search", { query });
async function changedCatalog<T>(promise: Promise<T>): Promise<T> {
  const result = await promise;
  window.dispatchEvent(new Event("oleafly:acp-catalog-changed"));
  return result;
}
export const acpRegister = (definitionJson: string) => changedCatalog(invoke<AcpDefinition>("acp_register", { definitionJson }));
export const acpRemoveAgent = (agentId: string) => changedCatalog(invoke<void>("acp_remove_agent", { agentId }));
export const acpInstall = (agentId: string) => changedCatalog(invoke<AcpAgentStatus>("acp_install", { agentId }));
export const acpStart = (projectId: string, agentId: string) => invoke<AcpSnapshot>("acp_start", { projectId, agentId });
export const acpReconnect = (projectId: string, sessionId: string) => invoke<AcpSnapshot>("acp_reconnect", { projectId, sessionId });
export const acpPrompt = (projectId: string, sessionId: string, text: string, images: AcpImage[] = []) => invoke<AcpSnapshot>("acp_prompt", { projectId, sessionId, text, images });
export const acpCancel = (projectId: string, sessionId: string) => invoke<void>("acp_cancel", { projectId, sessionId });
export const acpDisconnect = (projectId: string, sessionId: string) => invoke<void>("acp_disconnect", { projectId, sessionId });
export const acpAuthenticate = (projectId: string, sessionId: string, methodId: string) => invoke<AcpSnapshot>("acp_authenticate", { projectId, sessionId, methodId });
export const acpSetModel = (projectId: string, sessionId: string, modelId: string) => invoke<AcpSnapshot>("acp_set_model", { projectId, sessionId, modelId });
export const acpPermission = (projectId: string, sessionId: string, permissionId: string, optionId: string | null) => invoke<void>("acp_permission", { projectId, sessionId, permissionId, optionId });
export const acpSessions = (projectId: string) => invoke<AcpSession[]>("acp_sessions", { projectId });
export const acpSnapshot = (projectId: string, sessionId: string) => invoke<AcpSnapshot>("acp_snapshot", { projectId, sessionId });
export const acpEvents = (projectId: string, sessionId: string, after = 0, limit = 300) => invoke<AcpEventPage>("acp_events", { projectId, sessionId, after, limit });
export const onAcpEvent = (listener: (event: AcpEvent) => void) => listen<AcpEvent>("acp:event", ({ payload }) => listener(payload));
export const onAcpResync = (listener: () => void) => listen("acp:resync", listener);

export function acpError(error: unknown): string {
  return typeof error === "string" ? error : error instanceof Error ? error.message : "The ACP request could not be completed.";
}
