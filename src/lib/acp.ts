import { i18n } from "@/i18n";
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
  cli: AcpCliStatus | null;
  bridgeSharedWithCli: boolean;
  /** The program the user chose for this agent, when set. */
  programOverride?: string | null;
  /** The bridge cannot work without the vendor CLI (Pi). */
  cliRequired?: boolean;
}
export type AcpRejectReason = "not_found" | "is_directory" | "not_executable" | "unsupported_script" | "gui_program" | "interpreter" | "network_path";
export interface AcpRejectedCandidate { path: string; reason: AcpRejectReason }
export interface AcpCliStatus {
  command: string;
  displayName: string;
  path: string | null;
  version: string | null;
  signInCommand: string;
  /** "auto" when found by searching, "override" when chosen by the user. */
  source?: "auto" | "override" | null;
  /** Files with the right name that cannot be started. */
  rejected?: AcpRejectedCandidate[];
}
export type AcpCheckCode =
  | "ready" | "not_found" | "is_directory" | "unsupported_script" | "not_executable" | "gui_program" | "interpreter"
  | "network_path" | "cli_missing" | "bridge_missing" | "node_missing" | "node_too_old" | "start_failed" | "timeout"
  | "exited" | "not_acp";
/** Result of the agent Test check. */
export interface AcpAgentCheck {
  ok: boolean;
  code: AcpCheckCode;
  detail: string | null;
  program: string | null;
  version: string | null;
  agentName: string | null;
}
export type AcpReadiness = "ready" | "bridge-missing" | "cli-missing" | "unavailable";
export function acpReadiness(agent: AcpAgentStatus): AcpReadiness {
  // A bridge that cannot run without the vendor CLI (Pi) is not ready while the CLI is missing.
  if (agent.cliRequired && !agent.cli?.path) return "cli-missing";
  if (agent.installed) return "ready";
  if (agent.cli && !agent.cli.path) return "cli-missing";
  if (agent.canInstall || agent.cli?.path) return "bridge-missing";
  return "unavailable";
}
/** Whether a conversation can start with this agent right now. */
export function acpUsable(agent: AcpAgentStatus): boolean {
  return acpReadiness(agent) === "ready";
}
const READINESS_LABELS: Record<AcpReadiness, () => string> = {
  ready: () => i18n.t(($) => $.core.acp.readiness.ready),
  "bridge-missing": () => i18n.t(($) => $.core.acp.readiness.bridgeMissing),
  "cli-missing": () => i18n.t(($) => $.core.acp.readiness.cliMissing),
  unavailable: () => i18n.t(($) => $.core.acp.readiness.unavailable),
};
export function acpReadinessLabel(readiness: AcpReadiness): string {
  return READINESS_LABELS[readiness]();
}
export interface AcpRegistryEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  definition: AcpDefinition | null;
  reason: string | null;
  /** The built-in agent this registry entry corresponds to, when known. */
  builtinId?: string | null;
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
  authMethods: { id: string; name: string; description: string | null; kind?: string | null }[];
  error: string | null;
  lastSequence: number;
  /** HEAD commit when the session started, when the project is a Git repository. */
  startRevision?: string | null;
  /** Whether the working tree had uncommitted changes when the session started. */
  startDirty?: boolean | null;
}
export interface AcpPermission {
  id: string;
  sessionId: string;
  turnId: string;
  title: string;
  toolCallId: string | null;
  options: { optionId: string; name: string; kind: string }[];
  expiresAt: number;
  /** The ACP tool kind (for example "edit"), when reported. */
  kind?: string | null;
  /** Target paths, project-relative when inside the project. */
  locations?: string[];
  /** The proposed file changes, redacted and size-capped. */
  diffs?: AcpPermissionDiff[];
}
export interface AcpPermissionDiff { path: string; oldText: string | null; newText: string | null; truncated: boolean }
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
export const acpPrompt = (projectId: string, sessionId: string, text: string, images: AcpImage[] = [], skillId: string | null = null) => invoke<AcpSnapshot>("acp_prompt", { projectId, sessionId, text, images, skillId });
export const acpCancel = (projectId: string, sessionId: string) => invoke<void>("acp_cancel", { projectId, sessionId });
export const acpDisconnect = (projectId: string, sessionId: string) => invoke<void>("acp_disconnect", { projectId, sessionId });
export const acpAuthenticate = (projectId: string, sessionId: string, methodId: string) => invoke<AcpSnapshot>("acp_authenticate", { projectId, sessionId, methodId });
export const acpSetModel = (projectId: string, sessionId: string, modelId: string) => invoke<AcpSnapshot>("acp_set_model", { projectId, sessionId, modelId });
export const acpPermission = (projectId: string, sessionId: string, permissionId: string, optionId: string | null) => invoke<void>("acp_permission", { projectId, sessionId, permissionId, optionId });
export const acpDelegatedPermission = (projectId: string, sessionId: string, parentSessionId: string, permissionId: string, optionId: string | null) => invoke<void>("acp_delegated_permission", { projectId, sessionId, parentSessionId, permissionId, optionId });
export const acpSessions = (projectId: string) => invoke<AcpSession[]>("acp_sessions", { projectId });
export const acpSnapshot = (projectId: string, sessionId: string) => invoke<AcpSnapshot>("acp_snapshot", { projectId, sessionId });
export const acpEvents = (projectId: string, sessionId: string, after = 0, limit = 300) => invoke<AcpEventPage>("acp_events", { projectId, sessionId, after, limit });

// CLI agent setup (#84)
/** Tests an agent program without saving it: `path`, or the current resolution when omitted. */
export const acpCheckAgent = (agentId: string, path: string | null = null) => invoke<AcpAgentCheck>("acp_check_agent", { agentId, path });
/** Opens a native file dialog; resolves to the chosen path or null when cancelled. */
export const acpPickAgentProgram = (agentId: string) => invoke<string | null>("acp_pick_agent_program", { agentId });
/** Saves (or clears with null) the program the user chose for an agent. */
export const acpSetAgentProgram = (agentId: string, path: string | null) => changedCatalog(invoke<AcpAgentStatus>("acp_set_agent_program", { agentId, path }));

// CLI agent conversations (#84)
/** Writes the conversation as JSON to `path`. */
export const acpSessionExport = (projectId: string, sessionId: string, path: string) => invoke<void>("acp_session_export", { projectId, sessionId, path });
/** Every stored event of a conversation, oldest first. */
export const acpSessionEventsAll = (projectId: string, sessionId: string) => invoke<AcpEvent[]>("acp_session_events_all", { projectId, sessionId });

export const onAcpEvent = (listener: (event: AcpEvent) => void) => listen<AcpEvent>("acp:event", ({ payload }) => listener(payload));
export const onAcpResync = (listener: () => void) => listen("acp:resync", listener);

export function acpError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return i18n.t(($) => $.core.acp.requestFailed);
}
