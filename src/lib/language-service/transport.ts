import type { JsonRpcMessage } from "./json-rpc";

/** Closed Rust-side sidecar allowlist. Document engines map to this elsewhere. */
export type LanguageServiceKind = "texlab" | "tinymist";

export interface LanguageServiceSession {
  session: string;
  kind: LanguageServiceKind;
  generation: number;
}

export interface LanguageServiceRuntimeSession
  extends LanguageServiceSession {
  projectId: string;
  workspaceRoot: string;
}

export interface LanguageServiceStartOptions {
  kind: LanguageServiceKind;
  projectId: string;
}

export type LanguageServiceInstallState =
  | "installed"
  | "already_installed";

export type LanguageServiceInstallStatusState =
  | "installed"
  | "missing"
  | "installing"
  | "failed";

export interface LanguageServiceInstallResult {
  kind: LanguageServiceKind;
  version: string;
  state: LanguageServiceInstallState;
}

export interface LanguageServiceInstallStatus {
  kind: LanguageServiceKind;
  version: string;
  state: LanguageServiceInstallStatusState;
  message?: string;
}

export type LanguageServiceTransportState =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "exited"
  | "error";

export interface LanguageServiceTransportStatus {
  state: LanguageServiceTransportState;
  session: LanguageServiceRuntimeSession | null;
  error?: string;
}

interface TaggedTransportEvent extends LanguageServiceSession {
  sequence: number;
}

export interface LanguageServiceMessageEvent extends TaggedTransportEvent {
  type: "message";
  message: unknown;
}

export interface LanguageServiceErrorEvent extends TaggedTransportEvent {
  type: "error";
  error: string;
}

export interface LanguageServiceExitEvent extends TaggedTransportEvent {
  type: "exit";
  code: number | null;
  signal: number | null;
}

export interface LanguageServiceLogEvent extends TaggedTransportEvent {
  type: "log";
  stream: "stdout" | "stderr";
  message: string;
}

export type LanguageServiceTransportEvent =
  | LanguageServiceMessageEvent
  | LanguageServiceErrorEvent
  | LanguageServiceExitEvent
  | LanguageServiceLogEvent;

export type LanguageServiceEventSink = (
  event: LanguageServiceTransportEvent,
) => void;

/**
 * Platform-neutral transport boundary. A Tauri sidecar, worker, WebSocket, or
 * test double can implement this without leaking its runtime into the client.
 *
 * Every operation carries the full session identity. Implementations must not
 * route a send or stop intended for an old generation to a restarted process.
 * The transport, rather than the client, owns session allocation: Tauri's
 * backend returns an opaque session id and generation from `start`.
 */
export interface LanguageServiceTransport {
  status(): LanguageServiceTransportStatus;
  start(
    options: LanguageServiceStartOptions,
    sink: LanguageServiceEventSink,
  ): Promise<LanguageServiceRuntimeSession>;
  send(
    session: LanguageServiceSession,
    message: JsonRpcMessage,
  ): Promise<void>;
  refreshStatus(
    session: LanguageServiceSession,
  ): Promise<LanguageServiceTransportStatus>;
  stop(session: LanguageServiceSession): Promise<void>;
  /**
   * Retries transport-owned cleanup that could not be attached to a complete
   * runtime session DTO. This must be safe to call when nothing is retained.
   */
  cleanup(): Promise<void>;
  install?(
    kind: LanguageServiceKind,
  ): Promise<LanguageServiceInstallResult>;
  installStatus?(
    kind: LanguageServiceKind,
  ): Promise<LanguageServiceInstallStatus>;
}
