import type { DocumentSession } from "@oleafly/editor/document-session";
import {
  ActorIdSchema,
  FileIdSchema,
  ReplicaIdSchema,
  SharedProjectIdSchema,
  type FileId,
  type ServerInstanceId,
  type ServerProfileId,
  type SharedProjectId,
  type ReplicaId,
} from "@oleafly/realtime-protocol";
import { LiveSource, type LiveSaveState, uuidV7 } from "./live-source";
import type { RealtimeDesktopPort } from "./desktop-port";
import { TauriRealtimeDesktopPort } from "./tauri-desktop-port";

export const REALTIME_EXPERIMENT_FLAG = "oleafly.experimentalRealtime";
export const REALTIME_CONFIG_KEY = "oleafly.realtime.v1";

export interface ExperimentalRealtimeConfig {
  readonly baseUrl: string;
  readonly projectId: string;
  readonly actorId?: string;
  readonly replicaId: string;
  readonly fileId: string;
  /** Loopback-development credential. It is intentionally never persisted. */
  readonly devToken?: string;
  readonly seedFromLocalFile: boolean;
}

export type RealtimeDocumentAccess =
  | { readonly kind: "solo" }
  | {
      readonly kind: "shared";
      readonly session: DocumentSession | null;
      readonly message: string;
    };

type RuntimeSnapshot = Readonly<{
  generation: number;
  connection: "off" | "connecting" | "connected" | "error";
  saveState: LiveSaveState | null;
  error: string | null;
}>;

interface RuntimeScope {
  readonly localProjectId: string;
  readonly path: string;
  readonly fileId: FileId;
  readonly projectId: SharedProjectId;
  readonly replicaId: ReplicaId;
  readonly serverInstanceId?: ServerInstanceId;
}

const OFF: RuntimeSnapshot = {
  generation: 0,
  connection: "off",
  saveState: null,
  error: null,
};

export class RealtimeRuntime {
  readonly #port: RealtimeDesktopPort;
  readonly #listeners = new Set<() => void>();
  #source: LiveSource | null = null;
  #session: DocumentSession | null = null;
  #scope: RuntimeScope | null = null;
  #snapshot = OFF;
  #unsubscribeStatus: (() => void) | null = null;
  #operationGeneration = 0;
  #observedProjectId: string | null = null;
  #probingProjectId: string | null = null;
  #knownSoloProjectId: string | null = null;
  #failedSharedProjectId: string | null = null;
  #bindingProbeGeneration = 0;

  constructor(port: RealtimeDesktopPort = new TauriRealtimeDesktopPort()) {
    this.#port = port;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): RuntimeSnapshot => this.#snapshot;

  getDocumentAccess(localProjectId: string | null, path: string): RealtimeDocumentAccess {
    if (
      localProjectId &&
      (this.#probingProjectId === localProjectId ||
        this.#failedSharedProjectId === localProjectId)
    ) {
      return {
        kind: "shared",
        session: null,
        message:
          this.#snapshot.connection === "error"
            ? "Could not verify this project's sharing status. Editing is disabled."
            : "Checking project sharing...",
      };
    }
    const scope = this.#scope;
    if (scope?.localProjectId === localProjectId) {
      if (scope.path !== path) {
        return {
          kind: "shared",
          session: null,
          message: "Live Source can edit only the shared file selected in setup.",
        };
      }
      if (
        this.#session &&
        this.#session.documentId === scope.fileId &&
        this.#source?.readyForEditing()
      ) {
        return { kind: "shared", session: this.#session, message: "" };
      }
      return {
        kind: "shared",
        session: null,
        message:
          this.#snapshot.connection === "error"
            ? "Connect to the collaboration server before editing this shared file."
            : "Downloading and saving the shared file...",
      };
    }
    if (localProjectId && this.#knownSoloProjectId === localProjectId) {
      return { kind: "solo" };
    }
    // A project is solo only after the encrypted native binding lookup says so.
    // Relaunch, malformed setup, and native lookup failures all stay fail-closed.
    return localProjectId
      ? {
          kind: "shared",
          session: null,
          message: "Could not verify this project's sharing status. Editing is disabled.",
        }
      : { kind: "solo" };
  }

  async connect(
    config: ExperimentalRealtimeConfig,
    localProjectId: string,
    path: string,
    content: string,
    credentials?: { readonly username: string; readonly password: string },
  ): Promise<void> {
    let projectId: SharedProjectId;
    let replicaId: ReplicaId;
    let configuredFileId: FileId;
    let actorId: ReturnType<typeof ActorIdSchema.parse> | undefined;
    try {
      // Parse every renderer-controlled identifier before cancelling an active
      // encrypted-binding probe or tearing down an authoritative shared scope.
      projectId = SharedProjectIdSchema.parse(config.projectId);
      replicaId = ReplicaIdSchema.parse(config.replicaId);
      configuredFileId = FileIdSchema.parse(config.fileId);
      actorId = config.actorId ? ActorIdSchema.parse(config.actorId) : undefined;
    } catch (error) {
      this.#observedProjectId = localProjectId;
      this.#knownSoloProjectId = null;
      this.#failedSharedProjectId = localProjectId;
      this.#set({ connection: "error", saveState: null, error: String(error) });
      throw error;
    }

    if (this.#source?.hasUnrecoveredStorageFailure()) {
      const error = new Error(
        "Recover the failed local collaboration save before reconnecting.",
      );
      this.#failedSharedProjectId = this.#scope?.localProjectId ?? localProjectId;
      this.#set({
        connection: "error",
        saveState: this.#source.saveState(),
        error: error.message,
      });
      throw error;
    }

    const generation = ++this.#operationGeneration;
    this.#observedProjectId = localProjectId;
    this.#probingProjectId = null;
    this.#knownSoloProjectId = null;
    this.#failedSharedProjectId = null;
    ++this.#bindingProbeGeneration;
    await this.#teardownSource();
    if (generation !== this.#operationGeneration) return;

    this.#scope = {
      localProjectId,
      path,
      fileId: configuredFileId,
      projectId,
      replicaId,
    };
    this.#set({ connection: "connecting", error: null, saveState: null });

    let source: LiveSource | null = null;
    try {
      const descriptor = await this.#port.discoverServer(config.baseUrl);
      this.#assertCurrent(generation);
      const existingBinding = await this.#port.getBinding(localProjectId);
      this.#assertCurrent(generation);
      if (
        existingBinding &&
        (existingBinding.serverInstanceId !== descriptor.serverInstanceId ||
          existingBinding.projectId !== projectId ||
          existingBinding.replicaId !== replicaId ||
          existingBinding.fileId !== configuredFileId ||
          existingBinding.path !== path)
      ) {
        throw new Error(
          "This local project is bound to a different server, shared project, replica, file, or path.",
        );
      }
      if (credentials?.username && credentials.password) {
        await this.#port.loginLocal(
          config.baseUrl,
          credentials.username,
          credentials.password,
        );
        this.#assertCurrent(generation);
      }
      await this.#port.storeBinding({
        localProjectId,
        serverProfileId:
          existingBinding?.serverProfileId ?? (uuidV7() as ServerProfileId),
        serverInstanceId: descriptor.serverInstanceId,
        projectId,
        replicaId,
        fileId: configuredFileId,
        path,
        state: "shared_active",
      });
      this.#assertCurrent(generation);
      this.#scope = {
        ...this.#scope,
        serverInstanceId: descriptor.serverInstanceId,
      };
      const liveSource = new LiveSource(
        this.#port,
        {
          localProjectId,
          baseUrl: config.baseUrl,
          serverInstanceId: descriptor.serverInstanceId,
          projectId,
          replicaId,
          fileId: configuredFileId,
          actorId,
          devToken: config.devToken || undefined,
        },
        { fileId: configuredFileId, path, content },
        config.seedFromLocalFile,
      );
      source = liveSource;
      this.#source = source;
      this.#unsubscribeStatus = liveSource.subscribeStatus(() => {
        if (generation !== this.#operationGeneration || liveSource !== this.#source) return;
        if (liveSource.readyForEditing() && liveSource.hasText(configuredFileId) && !this.#session) {
          this.#session = liveSource.openText(configuredFileId);
        }
        const saveState = liveSource.saveState();
        this.#set({
          connection:
            saveState.kind === "error"
              ? "error"
              : saveState.kind === "offline"
                ? "connecting"
                : liveSource.readyForEditing()
                  ? "connected"
                  : "connecting",
          saveState,
          error: saveState.kind === "error" ? saveState.message : null,
        });
      });
      await liveSource.start();
      this.#assertCurrent(generation);
      if (liveSource.readyForEditing() && liveSource.hasText(configuredFileId)) {
        this.#session = liveSource.openText(configuredFileId);
      }
      this.#set({
        connection: liveSource.readyForEditing() ? "connected" : "connecting",
        saveState: liveSource.saveState(),
        error: null,
      });
    } catch (error) {
      if (source && source !== this.#source) await source.destroy();
      if (generation !== this.#operationGeneration) return;
      await this.#teardownSource();
      this.#set({ connection: "error", saveState: null, error: String(error) });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.#source?.hasUnrecoveredStorageFailure()) {
      const error = "Recover the failed local collaboration save before disconnecting.";
      this.#set({
        connection: "error",
        saveState: this.#source.saveState(),
        error,
      });
      return;
    }
    const generation = ++this.#operationGeneration;
    await this.#teardownSource();
    if (generation === this.#operationGeneration) {
      this.#set({ connection: "off", saveState: null, error: null });
    }
  }

  async retryStorage(): Promise<void> {
    if (!this.#source) throw new Error("no shared Source session is open");
    await this.#source.retryStorage();
  }

  async handleProjectSwitch(localProjectId: string | null): Promise<void> {
    if (this.#source?.hasUnrecoveredStorageFailure()) {
      this.#set({
        connection: "error",
        saveState: this.#source.saveState(),
        error: "Recover the failed local collaboration save before switching projects.",
      });
      return;
    }
    this.observeProject(localProjectId);
    const generation = this.#operationGeneration;
    await this.#teardownSource();
    if (generation === this.#operationGeneration && localProjectId === this.#observedProjectId) {
      this.#set({ connection: "off", saveState: null, error: null });
    }
  }

  observeProject(localProjectId: string | null): void {
    if (this.#observedProjectId === localProjectId) return;
    if (this.#source?.hasUnrecoveredStorageFailure()) {
      // Called during Editor render. Keep the current error snapshot and source
      // alive without publishing from this synchronous access probe.
      return;
    }
    this.#observedProjectId = localProjectId;
    this.#knownSoloProjectId = null;
    this.#failedSharedProjectId = null;
    this.#probingProjectId = localProjectId;
    const probeGeneration = ++this.#bindingProbeGeneration;
    ++this.#operationGeneration;
    this.#scope = null;
    void this.#teardownSource().then(async () => {
      if (
        !localProjectId ||
        this.#observedProjectId !== localProjectId ||
        probeGeneration !== this.#bindingProbeGeneration
      ) {
        this.#probingProjectId = null;
        return;
      }
      try {
        const binding = await this.#port.getBinding(localProjectId);
        if (
          this.#observedProjectId !== localProjectId ||
          probeGeneration !== this.#bindingProbeGeneration
        ) return;
        this.#probingProjectId = null;
        if (binding) {
          this.#scope = {
            localProjectId,
            path: binding.path,
            fileId: binding.fileId,
            projectId: binding.projectId,
            replicaId: binding.replicaId,
            serverInstanceId: binding.serverInstanceId,
          };
        } else {
          this.#knownSoloProjectId = localProjectId;
        }
        this.#set({ connection: "off", saveState: null, error: null });
      } catch (error) {
        if (
          this.#observedProjectId !== localProjectId ||
          probeGeneration !== this.#bindingProbeGeneration
        ) return;
        // A failed binding lookup must not make an unknown project writable.
        this.#set({ connection: "error", saveState: null, error: String(error) });
      }
    });
  }

  async #teardownSource(): Promise<void> {
    const source = this.#source;
    if (source?.hasUnrecoveredStorageFailure()) {
      throw new Error("shared session has an unrecovered local save");
    }
    if (source) await source.destroy();
    this.#unsubscribeStatus?.();
    this.#unsubscribeStatus = null;
    if (this.#source === source) {
      this.#source = null;
      this.#session = null;
    }
  }

  #assertCurrent(generation: number): void {
    if (generation !== this.#operationGeneration) {
      throw new Error("realtime connection was cancelled");
    }
  }

  #set(next: Omit<RuntimeSnapshot, "generation">): void {
    this.#snapshot = { ...next, generation: this.#snapshot.generation + 1 };
    for (const listener of this.#listeners) listener();
  }
}

export const realtimeRuntime = new RealtimeRuntime();

export function realtimeExperimentEnabled(): boolean {
  return (
    import.meta.env.VITE_OLEAFLY_REALTIME === "1" ||
    localStorage.getItem(REALTIME_EXPERIMENT_FLAG) === "true"
  );
}

export function loadRealtimeConfig(): ExperimentalRealtimeConfig | null {
  try {
    const raw = localStorage.getItem(REALTIME_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ExperimentalRealtimeConfig;
    return { ...parsed, devToken: undefined };
  } catch {
    return null;
  }
}

export function saveRealtimeConfig(config: ExperimentalRealtimeConfig): void {
  const { devToken: _credential, ...persistable } = config;
  localStorage.setItem(REALTIME_CONFIG_KEY, JSON.stringify(persistable));
}

export function saveStateLabel(state: LiveSaveState | null): string {
  if (!state) return "Not connected";
  switch (state.kind) {
    case "saved_locally":
      return "Saved locally";
    case "saving_locally":
      return "Saving locally…";
    case "syncing":
      return "Syncing";
    case "saved_to_team":
      return "Saved to team";
    case "offline":
      return `Offline - ${state.pending} change${state.pending === 1 ? "" : "s"} safe locally`;
    case "error":
      return `Local save error - ${state.pending} pending`;
  }
}

export function fileId(value: string): FileId {
  return FileIdSchema.parse(value);
}
