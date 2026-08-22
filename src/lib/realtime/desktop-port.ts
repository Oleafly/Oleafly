import type {
  ActorId,
  ClientUpdateId,
  DurableReceiptV1,
  FileId,
  ReplicaId,
  ServerInstanceId,
  SharedProjectBinding,
  SharedProjectId,
} from "@oleafly/realtime-protocol";

export interface ServerDescriptor {
  readonly serverInstanceId: ServerInstanceId;
  readonly protocolVersions: readonly number[];
  readonly webSocketUrlTemplate: string;
  readonly experimental: boolean;
}

export interface ServerProfile {
  readonly profileId: string;
  readonly baseUrl: string;
  readonly serverInstanceId: ServerInstanceId;
  readonly label: string;
}

export interface AuthFlow {
  readonly kind: "local" | "oidc";
}

export interface DevBootstrapClient {
  readonly actorId: ActorId;
  readonly replicaId: ReplicaId;
  readonly displayName: string;
}

export interface DevBootstrapResult {
  readonly projectId: SharedProjectId;
  readonly clients: readonly DevBootstrapClient[];
}

export interface OpenSessionInput {
  readonly localProjectId: string;
  readonly baseUrl: string;
  readonly serverInstanceId: ServerInstanceId;
  readonly projectId: SharedProjectId;
  readonly replicaId: ReplicaId;
  readonly fileId: FileId;
  readonly actorId?: ActorId;
  readonly devToken?: string;
}

export interface SessionHandle {
  readonly id: string;
}

export type RealtimeTransportEvent =
  | { readonly kind: "connected"; readonly sessionId: string }
  | { readonly kind: "disconnected"; readonly sessionId: string; readonly reason: string }
  | { readonly kind: "frame"; readonly sessionId: string; readonly bytes: Uint8Array };

export interface RealtimeBindingIdentity {
  readonly localProjectId: string;
  readonly serverInstanceId: ServerInstanceId;
  readonly projectId: SharedProjectId;
  readonly replicaId: ReplicaId;
  readonly fileId: FileId;
}

export interface DesktopSharedProjectBinding extends SharedProjectBinding {
  readonly fileId: FileId;
  readonly path: string;
}

export interface PendingMutationIdentity {
  readonly clientUpdateId: ClientUpdateId;
  readonly replicaId: ReplicaId;
  readonly clientSequence: bigint;
}

export interface ReplicaHydration {
  readonly clientSequence: bigint;
  readonly state: Uint8Array;
  readonly pending: readonly (PendingMutationIdentity & {
    readonly encodedFrame: Uint8Array;
  })[];
}

export interface PersistedMutation {
  readonly identity: RealtimeBindingIdentity;
  readonly handle: SessionHandle;
  readonly clientUpdateId: ClientUpdateId;
  readonly encodedFrame: Uint8Array;
  readonly replicaState: Uint8Array;
}

export interface PersistMutationResult {
  readonly pendingCount: number;
  readonly queued: boolean;
}

export interface MaterializationBatch {
  readonly identity: RealtimeBindingIdentity;
  readonly files: readonly { fileId: FileId; path: string; content: string }[];
}

export interface RealtimeDesktopPort {
  discoverServer(baseUrl: string): Promise<ServerDescriptor>;
  authenticate(profileId: string): Promise<AuthFlow>;
  listProfiles(): Promise<ServerProfile[]>;
  devBootstrap(baseUrl: string, devToken: string): Promise<DevBootstrapResult>;
  loginLocal(baseUrl: string, username: string, password: string): Promise<void>;

  getBinding(localProjectId: string): Promise<DesktopSharedProjectBinding | null>;
  storeBinding(binding: DesktopSharedProjectBinding): Promise<void>;

  openProjectSession(input: OpenSessionInput): Promise<SessionHandle>;
  closeProjectSession(handle: SessionHandle): Promise<void>;
  subscribe(listener: (event: RealtimeTransportEvent) => void): () => void;
  /** Only state-vector requests and client presence may cross this non-durable path. */
  sendEphemeralFrame(handle: SessionHandle, frame: Uint8Array): Promise<void>;

  hydrateReplica(identity: RealtimeBindingIdentity): Promise<ReplicaHydration>;
  persistMutationAndSend(input: PersistedMutation): Promise<PersistMutationResult>;
  persistReplicaState(
    identity: RealtimeBindingIdentity,
    state: Uint8Array,
  ): Promise<void>;
  acknowledgeMutation(
    identity: RealtimeBindingIdentity,
    receipt: DurableReceiptV1,
  ): Promise<void>;

  materialize(batch: MaterializationBatch): Promise<void>;
}
