import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DurableReceiptV1 } from "@oleafly/realtime-protocol";
import type {
  AuthFlow,
  DesktopSharedProjectBinding,
  DevBootstrapResult,
  MaterializationBatch,
  OpenSessionInput,
  PersistMutationResult,
  PersistedMutation,
  RealtimeBindingIdentity,
  RealtimeDesktopPort,
  RealtimeTransportEvent,
  ReplicaHydration,
  ServerDescriptor,
  ServerProfile,
  SessionHandle,
} from "./desktop-port";

interface NativeTransportEvent {
  readonly kind: "connected" | "disconnected" | "frame";
  readonly session_id: string;
  readonly reason?: string;
  readonly bytes_base64?: string;
}

export class TauriRealtimeDesktopPort implements RealtimeDesktopPort {
  readonly #listeners = new Set<(event: RealtimeTransportEvent) => void>();
  readonly #readySessions = new Set<string>();
  readonly #earlyEvents = new Map<string, RealtimeTransportEvent[]>();
  #nativeUnlisten: Promise<() => void> | null = null;

  discoverServer(baseUrl: string): Promise<ServerDescriptor> {
    return invoke("realtime_discover", { baseUrl });
  }

  async authenticate(_profileId: string): Promise<AuthFlow> {
    return { kind: "local" };
  }

  async listProfiles(): Promise<ServerProfile[]> {
    return [];
  }

  devBootstrap(baseUrl: string, devToken: string): Promise<DevBootstrapResult> {
    return invoke("realtime_dev_bootstrap", { baseUrl, devToken });
  }

  loginLocal(baseUrl: string, username: string, password: string): Promise<void> {
    return invoke("realtime_local_login", { baseUrl, username, password });
  }

  getBinding(localProjectId: string): Promise<DesktopSharedProjectBinding | null> {
    return invoke("realtime_get_binding", { localProjectId });
  }

  storeBinding(binding: DesktopSharedProjectBinding): Promise<void> {
    return invoke("realtime_store_binding", { binding });
  }

  async openProjectSession(input: OpenSessionInput): Promise<SessionHandle> {
    // Register the native event listener before the Rust session can emit its
    // first connected event. Missing that event would leave the Yjs handshake
    // waiting forever even though the socket itself is already open.
    await this.#ensureNativeListener();
    const handle = await invoke<SessionHandle>("realtime_open_session", { input });
    this.#readySessions.add(handle.id);
    for (const event of this.#earlyEvents.get(handle.id) ?? []) this.#emit(event);
    this.#earlyEvents.delete(handle.id);
    return handle;
  }

  async closeProjectSession(handle: SessionHandle): Promise<void> {
    this.#readySessions.delete(handle.id);
    this.#earlyEvents.delete(handle.id);
    await invoke("realtime_close_session", { sessionId: handle.id });
  }

  subscribe(listener: (event: RealtimeTransportEvent) => void): () => void {
    this.#listeners.add(listener);
    this.#ensureNativeListener();
    return () => this.#listeners.delete(listener);
  }

  sendEphemeralFrame(handle: SessionHandle, frame: Uint8Array): Promise<void> {
    return invoke("realtime_send_ephemeral_frame", {
      sessionId: handle.id,
      frameBase64: bytesToBase64(frame),
    });
  }

  async hydrateReplica(identity: RealtimeBindingIdentity): Promise<ReplicaHydration> {
    const hydration = await invoke<{
      clientSequence: string;
      stateBase64: string;
      pending: readonly {
        clientUpdateId: ReplicaHydration["pending"][number]["clientUpdateId"];
        replicaId: ReplicaHydration["pending"][number]["replicaId"];
        clientSequence: string;
        encodedFrameBase64: string;
      }[];
    }>("realtime_hydrate_replica", { identity });
    return {
      clientSequence: BigInt(hydration.clientSequence),
      state: hydration.stateBase64
        ? base64ToBytes(hydration.stateBase64)
        : new Uint8Array(),
      pending: hydration.pending.map((entry) => ({
        clientUpdateId: entry.clientUpdateId,
        replicaId: entry.replicaId,
        clientSequence: BigInt(entry.clientSequence),
        encodedFrame: base64ToBytes(entry.encodedFrameBase64),
      })),
    };
  }

  persistMutationAndSend(input: PersistedMutation): Promise<PersistMutationResult> {
    return invoke("realtime_persist_and_send_mutation", {
      input: {
        identity: input.identity,
        sessionId: input.handle.id,
        clientUpdateId: input.clientUpdateId,
        encodedFrameBase64: bytesToBase64(input.encodedFrame),
        stateBase64: bytesToBase64(input.replicaState),
      },
    });
  }

  persistReplicaState(
    identity: RealtimeBindingIdentity,
    state: Uint8Array,
  ): Promise<void> {
    return invoke("realtime_persist_replica_state", {
      input: { identity, stateBase64: bytesToBase64(state) },
    });
  }

  acknowledgeMutation(
    identity: RealtimeBindingIdentity,
    receipt: DurableReceiptV1,
  ): Promise<void> {
    return invoke("realtime_acknowledge_mutation", {
      input: {
        identity,
        receipt: {
          clientUpdateId: receipt.clientUpdateId,
          replicaId: receipt.replicaId,
          clientSequence: receipt.clientSequence.toString(),
          serverSequence: receipt.serverSequence.toString(),
          authorizationEpoch: receipt.authorizationEpoch.toString(),
          committedAtUnixMs: receipt.committedAtUnixMs.toString(),
        },
      },
    });
  }

  materialize(batch: MaterializationBatch): Promise<void> {
    return invoke("realtime_materialize", { batch });
  }

  #ensureNativeListener(): Promise<() => void> {
    if (this.#nativeUnlisten) return this.#nativeUnlisten;
    this.#nativeUnlisten = listen<NativeTransportEvent>(
      "realtime://transport",
      ({ payload }) => {
        let event: RealtimeTransportEvent;
        if (payload.kind === "frame" && payload.bytes_base64) {
          event = {
            kind: "frame",
            sessionId: payload.session_id,
            bytes: base64ToBytes(payload.bytes_base64),
          };
        } else if (payload.kind === "disconnected") {
          event = {
            kind: "disconnected",
            sessionId: payload.session_id,
            reason: payload.reason ?? "connection closed",
          };
        } else {
          event = { kind: "connected", sessionId: payload.session_id };
        }
        if (this.#readySessions.has(event.sessionId)) {
          this.#emit(event);
        } else {
          const early = this.#earlyEvents.get(event.sessionId) ?? [];
          // Connection setup only emits a handful of events. Keep a strict
          // cap so an invalid native producer cannot grow this queue.
          if (early.length < 16) early.push(event);
          this.#earlyEvents.set(event.sessionId, early);
        }
      },
    );
    return this.#nativeUnlisten;
  }

  #emit(event: RealtimeTransportEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}

/** E2E-only native replay observation. Production builds never emit this event. */
export function subscribeNativeReplayForE2e(
  listener: (encodedFrameBase64: string) => void,
): Promise<() => void> {
  return listen<{ readonly encodedFrameBase64: string }>(
    "realtime://e2e-replay",
    ({ payload }) => listener(payload.encodedFrameBase64),
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
