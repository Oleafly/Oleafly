import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  REALTIME_PROTOCOL_VERSION,
  decodeClientToServerFrameV1,
  encodeServerToClientFrameV1,
  type ActorId,
  type ClientUpdateId,
  type DurableReceiptV1,
  type FileId,
  type ReplicaId,
  type ServerInstanceId,
  type SharedProjectId,
} from "@oleafly/realtime-protocol";
import type {
  DesktopSharedProjectBinding,
  DevBootstrapResult,
  OpenSessionInput,
  PersistedMutation,
  RealtimeBindingIdentity,
  RealtimeDesktopPort,
  RealtimeTransportEvent,
  ReplicaHydration,
  ServerDescriptor,
  SessionHandle,
} from "./desktop-port";
import { LiveSource, editsFromDelta } from "./live-source";

const PROJECT = "0198cf35-0000-7000-8000-000000000010" as SharedProjectId;
const FILE = "0198cf35-0000-7000-8000-000000000002" as FileId;
const INSTANCE = "1134c268-3f07-4361-b5c0-0bede22fb36b" as ServerInstanceId;
const ALICE = "550e8400-e29b-41d4-a716-446655440001" as ActorId;
const BOB = "550e8400-e29b-41d4-a716-446655440002" as ActorId;
const REPLICA_A = "0198cf35-0000-7000-8000-000000000021" as ReplicaId;
const REPLICA_B = "0198cf35-0000-7000-8000-000000000022" as ReplicaId;

class LoopbackPort implements RealtimeDesktopPort {
  readonly listeners = new Set<(event: RealtimeTransportEvent) => void>();
  readonly inputs = new Map<string, OpenSessionInput>();
  readonly pending = new Map<ClientUpdateId, PersistedMutation>();
  readonly cache = new Map<string, Uint8Array>();
  readonly sequences = new Map<string, bigint>();
  readonly online = new Set<string>();
  readonly mutationAttempts: Uint8Array[] = [];
  readonly server = new Y.Doc();
  mutationCount = 0;
  serverSequence = 0n;
  failMutationWrites = 0;
  failCacheWrites = 0;

  async discoverServer(): Promise<ServerDescriptor> {
    return { serverInstanceId: INSTANCE, protocolVersions: [1], webSocketUrlTemplate: "ws://127.0.0.1/{projectId}", experimental: true };
  }
  async authenticate() { return { kind: "local" as const }; }
  async listProfiles() { return []; }
  async devBootstrap(): Promise<DevBootstrapResult> { throw new Error("unused"); }
  async loginLocal(): Promise<void> {}
  async getBinding(): Promise<DesktopSharedProjectBinding | null> { return null; }
  async storeBinding(): Promise<void> {}
  async openProjectSession(input: OpenSessionInput): Promise<SessionHandle> {
    const id = input.replicaId;
    this.inputs.set(id, input);
    this.online.add(id);
    setTimeout(() => void this.reconnect(id), 0);
    return { id };
  }
  async closeProjectSession(handle: SessionHandle): Promise<void> {
    this.inputs.delete(handle.id);
    this.online.delete(handle.id);
  }
  subscribe(listener: (event: RealtimeTransportEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async hydrateReplica(identity: RealtimeBindingIdentity): Promise<ReplicaHydration> {
    const key = identityKey(identity);
    return {
      clientSequence: this.sequences.get(key) ?? 0n,
      state: this.cache.get(key) ?? new Uint8Array(),
      pending: [...this.pending.values()]
        .filter((entry) => identityKey(entry.identity) === key)
        .map((entry) => {
          const decoded = decodeClientToServerFrameV1(entry.encodedFrame);
          if (decoded.message.kind !== "mutation") throw new Error("bad test mutation");
          return {
            clientUpdateId: decoded.message.envelope.clientUpdateId,
            replicaId: decoded.message.envelope.replicaId,
            clientSequence: decoded.message.envelope.clientSequence,
            encodedFrame: entry.encodedFrame,
          };
        }),
    };
  }
  async persistMutationAndSend(input: PersistedMutation) {
    this.mutationAttempts.push(new Uint8Array(input.encodedFrame));
    if (this.failMutationWrites > 0) {
      this.failMutationWrites -= 1;
      throw new Error("injected atomic WAL failure");
    }
    const decoded = decodeClientToServerFrameV1(input.encodedFrame);
    if (decoded.message.kind !== "mutation") throw new Error("mutation required");
    expect(decoded.message.envelope.clientUpdateId).toBe(input.clientUpdateId);
    expect(decoded.message.envelope.replicaId).toBe(input.identity.replicaId);
    const key = identityKey(input.identity);
    this.cache.set(key, new Uint8Array(input.replicaState));
    this.sequences.set(key, decoded.message.envelope.clientSequence);
    this.pending.set(input.clientUpdateId, input);
    const queued = this.online.has(input.handle.id);
    if (queued) await this.deliverMutation(input.handle, input.encodedFrame);
    return { pendingCount: this.pending.size, queued };
  }
  async persistReplicaState(identity: RealtimeBindingIdentity, state: Uint8Array): Promise<void> {
    if (this.failCacheWrites > 0) {
      this.failCacheWrites -= 1;
      throw new Error("injected replica cache failure");
    }
    this.cache.set(identityKey(identity), new Uint8Array(state));
  }
  async acknowledgeMutation(
    identity: RealtimeBindingIdentity,
    receipt: DurableReceiptV1,
  ): Promise<void> {
    const entry = this.pending.get(receipt.clientUpdateId);
    if (!entry || identityKey(entry.identity) !== identityKey(identity)) {
      throw new Error("receipt binding mismatch");
    }
    const decoded = decodeClientToServerFrameV1(entry.encodedFrame);
    if (
      decoded.message.kind !== "mutation" ||
      decoded.message.envelope.replicaId !== receipt.replicaId ||
      decoded.message.envelope.clientSequence !== receipt.clientSequence
    ) {
      throw new Error("receipt mutation mismatch");
    }
    this.pending.delete(receipt.clientUpdateId);
  }
  async materialize(): Promise<void> {}
  async sendEphemeralFrame(handle: SessionHandle, bytes: Uint8Array): Promise<void> {
    if (!this.online.has(handle.id)) throw new Error("offline");
    const decoded = decodeClientToServerFrameV1(bytes);
    if (decoded.message.kind === "yjs_sync") {
      this.frame(handle.id, {
        kind: "yjs_sync",
        syncKind: "sync_update",
        payload: Y.encodeStateAsUpdate(this.server, decoded.message.payload),
      });
    } else if (decoded.message.kind === "client_presence") {
      const input = this.inputs.get(handle.id);
      if (!input?.actorId) throw new Error("presence sender is missing");
      for (const sessionId of this.inputs.keys()) {
        if (sessionId === handle.id || !this.online.has(sessionId)) continue;
        this.frame(sessionId, {
          kind: "server_presence",
          presence: {
            actorId: input.actorId,
            replicaId: input.replicaId,
            displayName: input.actorId === ALICE ? "Alice" : "Bob",
            colorToken: input.actorId === ALICE ? "leaf" : "sky",
            selection: decoded.message.presence.selection,
          },
        });
      }
    } else {
      throw new Error("non-durable transport rejected a mutation");
    }
  }
  async deliverMutation(handle: SessionHandle, bytes: Uint8Array): Promise<void> {
    const decoded = decodeClientToServerFrameV1(bytes);
    if (decoded.message.kind === "mutation") {
      this.mutationCount += 1;
      const envelope = decoded.message.envelope;
      Y.applyUpdate(this.server, envelope.update);
      for (const sessionId of this.inputs.keys()) {
        if (sessionId === handle.id || !this.online.has(sessionId)) continue;
        this.frame(sessionId, {
          kind: "yjs_sync",
          syncKind: "broadcast",
          payload: envelope.update,
        });
      }
      this.frame(handle.id, {
        kind: "durable_receipt",
        receipt: {
          clientUpdateId: envelope.clientUpdateId,
          replicaId: envelope.replicaId,
          clientSequence: envelope.clientSequence,
          serverSequence: ++this.serverSequence,
          authorizationEpoch: 1n,
          committedAtUnixMs: BigInt(Date.now()),
        },
      });
    }
  }
  frame(sessionId: string, message: Parameters<typeof encodeServerToClientFrameV1>[0]["message"]): void {
    this.emit({
      kind: "frame",
      sessionId,
      bytes: encodeServerToClientFrameV1({ protocolVersion: REALTIME_PROTOCOL_VERSION, message }),
    });
  }
  emit(event: RealtimeTransportEvent): void { for (const listener of this.listeners) listener(event); }
  disconnect(sessionId: string): void {
    this.online.delete(sessionId);
    this.emit({ kind: "disconnected", sessionId, reason: "test disconnect" });
  }
  async reconnect(sessionId: string): Promise<void> {
    const input = this.inputs.get(sessionId);
    if (!input) return;
    this.online.add(sessionId);
    for (const pending of this.pending.values()) {
      if (identityKey(pending.identity) === identityKey(input)) {
        await this.deliverMutation({ id: sessionId }, pending.encodedFrame);
      }
    }
    this.emit({ kind: "connected", sessionId });
  }
}

function identityKey(identity: RealtimeBindingIdentity | OpenSessionInput): string {
  return [
    identity.localProjectId,
    identity.serverInstanceId,
    identity.projectId,
    identity.replicaId,
    identity.fileId,
  ].join(":");
}

const input = (localProjectId: string, actorId: ActorId, replicaId: ReplicaId): OpenSessionInput => ({
  localProjectId,
  baseUrl: "http://127.0.0.1:8787",
  serverInstanceId: INSTANCE,
  projectId: PROJECT,
  actorId,
  replicaId,
  fileId: FILE,
  devToken: "test",
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 15));

describe("LiveSource", () => {
  it("converges minimal edits without feeding remote updates back to the server", async () => {
    const port = new LoopbackPort();
    const alice = new LiveSource(port, input("alice", ALICE, REPLICA_A), {
      fileId: FILE,
      path: "main.tex",
      content: "Hello 🌿",
    }, true);
    await alice.start();
    await tick();
    const bob = new LiveSource(port, input("bob", BOB, REPLICA_B), {
      fileId: FILE, path: "main.tex", content: "",
    });
    await bob.start();
    await tick();

    const aliceSession = alice.openText(FILE);
    const bobSession = bob.openText(FILE);
    const remoteChanges: string[] = [];
    bobSession.subscribe((change) => {
      if (change.source === "remote") remoteChanges.push(change.snapshot.text);
    });
    const before = port.mutationCount;
    aliceSession.apply([{ from: 6, to: 8, insert: "team" }], { origin: "human" });
    expect(alice.saveState()).toEqual({ kind: "saving_locally", pending: 1 });
    await tick();
    expect(bobSession.snapshot().text).toBe("Hello team");
    expect(remoteChanges).toEqual(["Hello team"]);
    expect(port.mutationCount).toBe(before + 1);
    expect(alice.saveState().kind).toBe("saved_to_team");

    bobSession.apply([{ from: 10, to: 10, insert: "!" }], { origin: "human" });
    await tick();
    expect(aliceSession.snapshot().text).toBe("Hello team!");
    expect(port.mutationCount).toBe(before + 2);
    await alice.destroy();
    await bob.destroy();
  });

  it("keeps undo local and resolves relative cursor positions after edits", async () => {
    const port = new LoopbackPort();
    const alice = new LiveSource(port, input("alice-undo", ALICE, REPLICA_A), {
      fileId: FILE,
      path: "main.tex",
      content: "abc",
    }, true);
    await alice.start();
    await tick();
    const bob = new LiveSource(port, input("bob-undo", BOB, REPLICA_B), {
      fileId: FILE, path: "main.tex", content: "",
    });
    await bob.start();
    await tick();
    const a = alice.openText(FILE);
    const b = bob.openText(FILE);
    a.apply([{ from: 3, to: 3, insert: "A" }], { origin: "human" });
    await tick();
    b.apply([{ from: 0, to: 0, insert: "B" }], { origin: "human" });
    await tick();
    a.undo();
    await tick();
    expect(a.snapshot().text).toBe("Babc");
    expect(b.snapshot().text).toBe("Babc");

    b.updateLocalSelection?.(2, 4);
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(a.collaborators?.()[0]).toMatchObject({ displayName: "Bob", anchor: 2, head: 4 });
    a.apply([{ from: 0, to: 0, insert: "!" }], { origin: "human" });
    await tick();
    expect(a.collaborators?.()[0]).toMatchObject({
      displayName: "Bob",
      replicaId: REPLICA_B,
      anchor: 3,
      head: 5,
    });
    await alice.destroy();
    await bob.destroy();
  });

  it("replays the original offline frame after a replica restart", async () => {
    const port = new LoopbackPort();
    let alice = new LiveSource(port, input("alice-restart", ALICE, REPLICA_A), {
      fileId: FILE,
      path: "main.tex",
      content: "safe",
    }, true);
    await alice.start();
    await tick();
    const bob = new LiveSource(port, input("bob-restart", BOB, REPLICA_B), {
      fileId: FILE, path: "main.tex", content: "",
    });
    await bob.start();
    await tick();

    port.disconnect(REPLICA_A);
    alice.openText(FILE).apply([{ from: 4, to: 4, insert: " offline" }], { origin: "human" });
    await tick();
    expect(alice.saveState()).toEqual({ kind: "offline", pending: 1 });
    const pendingFrame = [...port.pending.values()][0]?.encodedFrame;
    expect(pendingFrame).toBeDefined();
    await alice.destroy();

    alice = new LiveSource(port, input("alice-restart", ALICE, REPLICA_A), {
      fileId: FILE, path: "main.tex", content: "",
    });
    await alice.start();
    await tick();
    expect(alice.openText(FILE).snapshot().text).toBe("safe offline");
    expect(bob.openText(FILE).snapshot().text).toBe("safe offline");
    expect(port.pending.size).toBe(0);
    await alice.destroy();
    await bob.destroy();
  });

  it("latches the first WAL failure, freezes later edits, and recovers with full state", async () => {
    const port = new LoopbackPort();
    const alice = new LiveSource(port, input("alice-wal-failure", ALICE, REPLICA_A), {
      fileId: FILE,
      path: "main.tex",
      content: "safe",
    }, true);
    await alice.start();
    await tick();
    const bob = new LiveSource(port, input("bob-wal-failure", BOB, REPLICA_B), {
      fileId: FILE,
      path: "main.tex",
      content: "",
    });
    await bob.start();
    await tick();

    const aliceSession = alice.openText(FILE);
    const bobSession = bob.openText(FILE);
    const attemptsBeforeFailure = port.mutationAttempts.length;
    port.failMutationWrites = 1;
    aliceSession.apply([{ from: 4, to: 4, insert: " first" }], { origin: "human" });
    await tick();

    expect(alice.saveState()).toMatchObject({ kind: "error" });
    expect(alice.readyForEditing()).toBe(false);
    await expect(alice.destroy()).rejects.toThrow(/requires recovery/);
    expect(() =>
      aliceSession.apply([{ from: 10, to: 10, insert: " lost" }], { origin: "human" }),
    ).toThrow(/frozen/);
    expect(aliceSession.snapshot().text).toBe("safe first");
    expect(bobSession.snapshot().text).toBe("safe");

    await alice.retryStorage();
    await tick();
    expect(port.mutationAttempts).toHaveLength(attemptsBeforeFailure + 3);
    expect(port.mutationAttempts[attemptsBeforeFailure + 1]).toEqual(
      port.mutationAttempts[attemptsBeforeFailure],
    );
    expect(port.mutationAttempts[attemptsBeforeFailure + 2]).not.toEqual(
      port.mutationAttempts[attemptsBeforeFailure],
    );
    expect(aliceSession.snapshot().text).toBe("safe first");
    expect(bobSession.snapshot().text).toBe("safe first");
    expect(alice.readyForEditing()).toBe(true);
    expect(alice.saveState().kind).toBe("saved_to_team");
    expect(port.pending.size).toBe(0);

    await alice.destroy();
    await bob.destroy();
  });

  it("keeps a remote cache failure read-only until that exact state is persisted", async () => {
    const port = new LoopbackPort();
    const alice = new LiveSource(port, input("alice-cache-failure", ALICE, REPLICA_A), {
      fileId: FILE,
      path: "main.tex",
      content: "cache",
    }, true);
    await alice.start();
    await tick();
    const bob = new LiveSource(port, input("bob-cache-failure", BOB, REPLICA_B), {
      fileId: FILE,
      path: "main.tex",
      content: "",
    });
    await bob.start();
    await tick();

    port.failCacheWrites = 1;
    alice.openText(FILE).apply([{ from: 5, to: 5, insert: " remote" }], {
      origin: "human",
    });
    await tick();
    expect(bob.openText(FILE).snapshot().text).toBe("cache remote");
    expect(bob.saveState()).toMatchObject({ kind: "error" });
    expect(bob.readyForEditing()).toBe(false);
    expect(() =>
      bob.openText(FILE).apply([{ from: 12, to: 12, insert: "!" }], { origin: "human" }),
    ).toThrow(/frozen/);

    await bob.retryStorage();
    expect(bob.readyForEditing()).toBe(true);
    expect(bob.saveState().kind).toBe("saved_to_team");
    const hydration = await port.hydrateReplica(input("bob-cache-failure", BOB, REPLICA_B));
    const restored = new Y.Doc();
    Y.applyUpdate(restored, hydration.state);
    expect(
      restored.getMap<Y.Text>("texts").get(FILE)?.toString(),
    ).toBe("cache remote");

    await alice.destroy();
    await bob.destroy();
  });

  it("maps Y.Text deltas to old-document UTF-16 coordinates", () => {
    expect(editsFromDelta([{ retain: 1 }, { delete: 2 }, { insert: "leaf" }])).toEqual([
      { from: 1, to: 3, insert: "leaf" },
    ]);
  });
});
