import * as Y from "yjs";
import {
  AUTHORING_ROOTS,
  REALTIME_PROTOCOL_VERSION,
  applyAuthoringUpdateV1,
  createTextNodeV1,
  decodeServerToClientFrameV1,
  encodeClientToServerFrameV1,
  initializeAuthoringDocV1,
  type ClientUpdateId,
  type DurableReceiptV1,
  type EditSessionId,
  type FileId,
  type ReplicaId,
  type ServerPresenceV1,
} from "@oleafly/realtime-protocol";
import {
  validateTextEdits,
  type CollaboratorSelection,
  type DocumentChange,
  type DocumentChangeListener,
  type DocumentSession,
  type LocalRevision,
  type ProjectSource,
  type TextEdit,
  type TextSnapshot,
  type TransactionMeta,
  type TreeTransaction,
  type Unsubscribe,
} from "@oleafly/editor/document-session";
import type {
  OpenSessionInput,
  PersistedMutation,
  RealtimeBindingIdentity,
  RealtimeDesktopPort,
  RealtimeTransportEvent,
  SessionHandle,
} from "./desktop-port";

export type LiveSaveState =
  | { readonly kind: "saved_locally" }
  | { readonly kind: "saving_locally"; readonly pending: number }
  | { readonly kind: "syncing"; readonly pending: number }
  | { readonly kind: "saved_to_team" }
  | { readonly kind: "offline"; readonly pending: number }
  | { readonly kind: "error"; readonly pending: number; readonly message: string };

const CACHE_ORIGIN = Object.freeze({ kind: "oleafly_cache" });

export interface LiveSourceFile {
  readonly fileId: FileId;
  readonly path: string;
  readonly content: string;
}

interface PreparedLocalMutation extends PersistedMutation {
  readonly clientSequence: bigint;
}

export class LiveSource implements ProjectSource {
  readonly mode = "shared" as const;
  readonly doc = new Y.Doc();
  readonly #sessions = new Map<FileId, LiveDocumentSession>();
  readonly #statusListeners = new Set<() => void>();
  readonly #presence = new Map<ReplicaId, ServerPresenceV1>();
  readonly #pending = new Set<ClientUpdateId>();
  readonly #paths = new Map<FileId, string>();
  readonly #identity: RealtimeBindingIdentity;
  #handle: SessionHandle | null = null;
  #connected = false;
  #synchronized = false;
  #started = false;
  #destroyed = false;
  #version = 0;
  #clientSequence = 0n;
  #persisting = 0;
  #cacheWrites = 0;
  #editingReady = false;
  #storageError: string | null = null;
  #failedMutation: PreparedLocalMutation | null = null;
  #recoveryState: Uint8Array | null = null;
  #cacheRecoveryRequired = false;
  #failedReceipt: DurableReceiptV1 | null = null;
  #saveState: LiveSaveState = { kind: "saved_locally" };
  #unsubscribePort: (() => void) | null = null;
  #storageQueue: Promise<void> = Promise.resolve();
  #storageRetry: Promise<void> | null = null;
  #applyingRemote = false;
  #openingEvents: RealtimeTransportEvent[] = [];

  constructor(
    private readonly port: RealtimeDesktopPort,
    private readonly input: OpenSessionInput,
    private readonly file: LiveSourceFile,
    private readonly seedFromLocalFile = false,
  ) {
    this.#identity = {
      localProjectId: input.localProjectId,
      serverInstanceId: input.serverInstanceId,
      projectId: input.projectId,
      replicaId: input.replicaId,
      fileId: input.fileId,
    };
    if (file.fileId !== input.fileId) {
      throw new Error("configured FileId does not match the native session binding");
    }
    this.#paths.set(file.fileId, file.path);
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    const hydration = await this.port.hydrateReplica(this.#identity);
    if (this.#destroyed) return;
    this.#clientSequence = hydration.clientSequence;
    for (const pending of hydration.pending) {
      if (
        pending.replicaId !== this.input.replicaId ||
        pending.clientSequence > hydration.clientSequence
      ) {
        throw new Error("native pending mutation identity is inconsistent");
      }
      this.#pending.add(pending.clientUpdateId);
    }
    if (hydration.state.length > 0) {
      Y.applyUpdate(this.doc, hydration.state, CACHE_ORIGIN);
      this.#editingReady = this.#text(this.input.fileId) !== null;
    }

    let bootstrap: Uint8Array | null = null;
    if (this.seedFromLocalFile && !this.#text(this.file.fileId)) {
      initializeAuthoringDocV1(this.doc);
      createTextNodeV1(this.doc, {
        fileId: this.file.fileId,
        parentId: null,
        name: this.file.path,
        text: this.file.content,
      });
      bootstrap = Y.encodeStateAsUpdate(this.doc);
      this.#persisting += 1;
      this.#refreshSaveState();
    }

    this.doc.on("update", this.#onDocumentUpdate);
    this.#unsubscribePort = this.port.subscribe(this.#onTransportEvent);
    const handle = await this.port.openProjectSession(this.input);
    if (this.#destroyed) {
      await this.port.closeProjectSession(handle);
      return;
    }
    this.#handle = handle;
    if (bootstrap) {
      const replicaState = Y.encodeStateAsUpdate(this.doc);
      this.#queueLocalMutation(bootstrap, replicaState);
    }
    const openingEvents = this.#openingEvents;
    this.#openingEvents = [];
    for (const event of openingEvents) this.#onTransportEvent(event);
    this.#refreshSaveState();
  }

  async destroy(): Promise<void> {
    if (this.#destroyed) return;
    await this.#storageQueue.catch(() => undefined);
    await this.#storageRetry?.catch(() => undefined);
    if (this.#storageError) {
      throw new Error(
        "cannot close a shared session while an in-memory local save still requires recovery",
      );
    }
    this.#destroyed = true;
    this.doc.off("update", this.#onDocumentUpdate);
    this.#unsubscribePort?.();
    this.#unsubscribePort = null;
    for (const session of this.#sessions.values()) session.destroy();
    if (this.#handle) await this.port.closeProjectSession(this.#handle);
    this.#handle = null;
    this.#connected = false;
    this.#synchronized = false;
    this.doc.destroy();
  }

  hasText(fileId: FileId): boolean {
    return fileId === this.input.fileId && this.#text(fileId) !== null;
  }

  openText(fileId: FileId): DocumentSession {
    if (fileId !== this.input.fileId) {
      throw new Error("this shared Source slice exposes only its configured FileId");
    }
    let session = this.#sessions.get(fileId);
    if (session) return session;
    const text = this.#text(fileId);
    if (!text) throw new Error("shared text is not available until bootstrap completes");
    session = new LiveDocumentSession(this, fileId, text);
    this.#sessions.set(fileId, session);
    return session;
  }

  async applyTreeTransaction(_tx: TreeTransaction): Promise<void> {
    throw new Error("shared tree editing is outside the Source collaboration slice");
  }

  async captureProjectRevision(): Promise<LocalRevision> {
    return digestRevision(Y.encodeStateAsUpdate(this.doc));
  }

  saveState(): LiveSaveState {
    return this.#saveState;
  }

  readyForEditing(): boolean {
    return this.#editingReady;
  }

  hasUnrecoveredStorageFailure(): boolean {
    return this.#storageError !== null;
  }

  assertEditingReady(): void {
    if (!this.#editingReady || this.#storageError) {
      throw new Error(
        this.#storageError
          ? "shared editing is frozen until the failed local save is recovered"
          : "shared editing is not ready",
      );
    }
  }

  retryStorage(): Promise<void> {
    if (this.#storageRetry) return this.#storageRetry;
    const operation = this.#retryStorageOnce();
    const tracked = operation.finally(() => {
      if (this.#storageRetry === tracked) this.#storageRetry = null;
    });
    this.#storageRetry = tracked;
    return tracked;
  }

  async #retryStorageOnce(): Promise<void> {
    await this.#storageQueue;
    if (!this.#storageError) return;

    try {
      if (this.#failedReceipt) {
        const receipt = this.#failedReceipt;
        await this.port.acknowledgeMutation(this.#identity, receipt);
        this.#pending.delete(receipt.clientUpdateId);
        this.#failedReceipt = null;
      }

      if (this.#failedMutation) {
        // An fsync error is commit-uncertain: the atomic replacement may be on
        // disk even though directory durability failed. Replay the exact same
        // ID/sequence/frame first so the native journal can resolve that state
        // idempotently instead of skipping or forking a sequence.
        const failed = this.#failedMutation;
        this.#persisting += 1;
        this.#refreshSaveState();
        try {
          await this.#persistPreparedMutation(failed);
          this.#failedMutation = null;
        } catch (error) {
          this.#recordMutationStorageFailure(error, failed);
          throw error;
        }

        // A second edit may already have entered Y.Doc before the first async
        // error returned. Append a full-state recovery mutation so the server
        // receives a standalone reconstructible state after the exact replay.
        const state = new Uint8Array(
          this.#recoveryState ?? Y.encodeStateAsUpdate(this.doc),
        );
        const recovery = this.#prepareMutation(state, state);
        this.#persisting += 1;
        this.#refreshSaveState();
        try {
          await this.#persistPreparedMutation(recovery);
        } catch (error) {
          this.#recordMutationStorageFailure(error, recovery);
          throw error;
        }
        this.#recoveryState = null;
        this.#cacheRecoveryRequired = false;
      } else if (this.#cacheRecoveryRequired) {
        const state = new Uint8Array(
          this.#recoveryState ?? Y.encodeStateAsUpdate(this.doc),
        );
        this.#cacheWrites += 1;
        this.#refreshSaveState();
        try {
          await this.port.persistReplicaState(this.#identity, state);
          this.#cacheRecoveryRequired = false;
          this.#recoveryState = null;
        } finally {
          this.#cacheWrites = Math.max(0, this.#cacheWrites - 1);
        }
      }

      if (
        !this.#failedMutation &&
        !this.#cacheRecoveryRequired &&
        !this.#failedReceipt
      ) {
        this.#storageError = null;
      }
      this.#refreshSaveState();
    } catch (error) {
      this.#storageError = String(error);
      this.#editingReady = false;
      this.#recoveryState = Y.encodeStateAsUpdate(this.doc);
      this.#refreshSaveState();
      throw error;
    }
  }

  subscribeStatus(listener: () => void): Unsubscribe {
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  collaborators(fileId: FileId): readonly CollaboratorSelection[] {
    const text = this.#text(fileId);
    if (!text || fileId !== this.input.fileId) return [];
    const values: CollaboratorSelection[] = [];
    for (const presence of this.#presence.values()) {
      if (presence.replicaId === this.input.replicaId) continue;
      const selection = presence.selection;
      if (!selection || selection.fileId !== fileId) continue;
      const anchor = decodeAbsolutePosition(selection.anchorRelativePosition, this.doc, text);
      const head = decodeAbsolutePosition(selection.headRelativePosition, this.doc, text);
      if (anchor === null || head === null) continue;
      values.push({
        actorId: presence.actorId,
        replicaId: presence.replicaId,
        displayName: presence.displayName,
        colorToken: presence.colorToken,
        anchor,
        head,
      });
    }
    return values;
  }

  sendSelection(fileId: FileId, anchor: number | null, head: number | null): void {
    if (fileId !== this.input.fileId || !this.#handle || !this.#connected) return;
    const text = this.#text(fileId);
    if (!text && anchor !== null) return;
    const selection =
      anchor === null || head === null || !text
        ? null
        : {
            fileId,
            anchorRelativePosition: new Uint8Array(
              Y.encodeRelativePosition(
                Y.createRelativePositionFromTypeIndex(
                  text,
                  Math.max(0, Math.min(anchor, text.length)),
                ),
              ),
            ),
            headRelativePosition: new Uint8Array(
              Y.encodeRelativePosition(
                Y.createRelativePositionFromTypeIndex(
                  text,
                  Math.max(0, Math.min(head, text.length)),
                ),
              ),
            ),
          };
    const frame = encodeClientToServerFrameV1({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      message: { kind: "client_presence", presence: { selection } },
    });
    void this.port.sendEphemeralFrame(this.#handle, frame).catch(() => {
      this.#connected = false;
      this.#refreshSaveState();
    });
  }

  async flushMaterialization(fileId: FileId): Promise<void> {
    if (fileId !== this.input.fileId) {
      throw new Error("cannot materialize a FileId outside this shared binding");
    }
    const text = this.#text(fileId);
    const path = this.#paths.get(fileId);
    if (!text || !path) return;
    await this.#storageQueue;
    await this.port.materialize({
      identity: this.#identity,
      files: [{ fileId, path, content: text.toString() }],
    });
  }

  notifyPresence(): void {
    for (const session of this.#sessions.values()) session.notifyCollaborators();
  }

  bumpVersion(): number {
    return ++this.#version;
  }

  version(): number {
    return this.#version;
  }

  readonly #onDocumentUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === CACHE_ORIGIN || this.#destroyed) return;
    const replicaState = Y.encodeStateAsUpdate(this.doc);
    if (this.#applyingRemote) {
      if (this.#storageError) {
        this.#recoveryState = replicaState;
        if (!this.#failedMutation) this.#cacheRecoveryRequired = true;
        this.#editingReady = false;
        this.#refreshSaveState();
        return;
      }
      this.#cacheWrites += 1;
      this.#storageQueue = this.#storageQueue
        .then(() => this.port.persistReplicaState(this.#identity, replicaState))
        .then(() => {
          this.#cacheWrites = Math.max(0, this.#cacheWrites - 1);
          this.#refreshSaveState();
        })
        .catch((error) => {
          this.#cacheWrites = Math.max(0, this.#cacheWrites - 1);
          this.#recordCacheStorageFailure(error);
        });
      return;
    }

    // Leave "Saved to team" synchronously. Until the native command returns,
    // this update exists in memory but is not yet advertised as disk-safe.
    this.#persisting += 1;
    this.#refreshSaveState();
    this.#queueLocalMutation(new Uint8Array(update), replicaState);
  };

  #queueLocalMutation(update: Uint8Array, replicaState: Uint8Array): void {
    this.#storageQueue = this.#storageQueue
      .then(async () => {
        if (this.#storageError) {
          // An edit may have been dispatched before the first async disk error
          // returned. Fold it into the full recovery state and never let it
          // overtake or hide the failed predecessor.
          this.#recoveryState = Y.encodeStateAsUpdate(this.doc);
          if (!this.#failedMutation) {
            this.#failedMutation = this.#prepareMutation(update, replicaState);
          }
          this.#persisting = Math.max(0, this.#persisting - 1);
          this.#editingReady = false;
          this.#refreshSaveState();
          return;
        }
        const prepared = this.#prepareMutation(update, replicaState);
        try {
          await this.#persistPreparedMutation(prepared);
        } catch (error) {
          this.#recordMutationStorageFailure(error, prepared);
        }
      });
  }

  #prepareMutation(
    update: Uint8Array,
    replicaState: Uint8Array,
  ): PreparedLocalMutation {
    if (!this.#handle) throw new Error("native realtime session is not open");
    const clientUpdateId = uuidV7() as ClientUpdateId;
    const clientSequence = this.#clientSequence + 1n;
    const frame = encodeClientToServerFrameV1({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      message: {
        kind: "mutation",
        envelope: {
          clientUpdateId,
          replicaId: this.input.replicaId,
          clientSequence,
          editSessionId: uuidV7() as EditSessionId,
          origin: "human",
          update: new Uint8Array(update),
        },
      },
    });
    return {
      identity: this.#identity,
      handle: this.#handle,
      clientUpdateId,
      clientSequence,
      encodedFrame: frame,
      replicaState: new Uint8Array(replicaState),
    };
  }

  async #persistPreparedMutation(input: PreparedLocalMutation): Promise<void> {
    this.#pending.add(input.clientUpdateId);
    try {
      const result = await this.port.persistMutationAndSend(input);
      this.#clientSequence = input.clientSequence;
      if (!result.queued) this.#connected = false;
    } catch (error) {
      this.#pending.delete(input.clientUpdateId);
      throw error;
    } finally {
      this.#persisting = Math.max(0, this.#persisting - 1);
    }
    this.#refreshSaveState();
  }

  readonly #onTransportEvent = (event: RealtimeTransportEvent): void => {
    if (this.#destroyed) return;
    if (!this.#handle) {
      if (this.#openingEvents.length < 16) this.#openingEvents.push(event);
      return;
    }
    if (event.sessionId !== this.#handle.id) return;
    if (event.kind === "connected") {
      this.#connected = true;
      this.#synchronized = false;
      this.#refreshSaveState();
      const frame = encodeClientToServerFrameV1({
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        message: {
          kind: "yjs_sync",
          syncKind: "state_vector",
          payload: Y.encodeStateVector(this.doc),
        },
      });
      void this.port.sendEphemeralFrame(this.#handle, frame).catch(() => {
        this.#connected = false;
        this.#refreshSaveState();
      });
      return;
    }
    if (event.kind === "disconnected") {
      this.#connected = false;
      this.#synchronized = false;
      this.#refreshSaveState();
      return;
    }
    let decoded: ReturnType<typeof decodeServerToClientFrameV1>;
    try {
      decoded = decodeServerToClientFrameV1(event.bytes);
    } catch {
      return;
    }
    const message = decoded.message;
    if (message.kind === "yjs_sync") {
      this.#applyingRemote = true;
      try {
        applyAuthoringUpdateV1(this.doc, message.payload);
      } finally {
        this.#applyingRemote = false;
      }
      this.#ensureJoinedSession();
      this.#synchronized = true;
      this.#refreshSaveState();
    } else if (message.kind === "durable_receipt") {
      void this.#acknowledge(message.receipt);
    } else if (message.kind === "server_presence") {
      this.#presence.set(message.presence.replicaId, message.presence);
      this.notifyPresence();
    }
  };

  async #acknowledge(receipt: DurableReceiptV1): Promise<void> {
    try {
      await this.port.acknowledgeMutation(this.#identity, receipt);
      this.#pending.delete(receipt.clientUpdateId);
      this.#refreshSaveState();
    } catch (error) {
      this.#failedReceipt = receipt;
      this.#recordStorageFailure(error);
    }
  }

  #ensureJoinedSession(): void {
    if (this.#text(this.input.fileId)) {
      for (const listener of this.#statusListeners) listener();
    }
    this.notifyPresence();
  }

  #text(fileId: FileId): Y.Text | null {
    const value = this.doc.getMap<unknown>(AUTHORING_ROOTS.texts).get(fileId);
    return value instanceof Y.Text ? value : null;
  }

  #recordMutationStorageFailure(
    error: unknown,
    mutation: PreparedLocalMutation,
  ): void {
    if (!this.#failedMutation) {
      this.#failedMutation = mutation;
    }
    this.#recoveryState = Y.encodeStateAsUpdate(this.doc);
    this.#recordStorageFailure(error);
  }

  #recordCacheStorageFailure(error: unknown): void {
    this.#cacheRecoveryRequired = true;
    this.#recoveryState = Y.encodeStateAsUpdate(this.doc);
    this.#recordStorageFailure(error);
  }

  #recordStorageFailure(error: unknown): void {
    this.#storageError = String(error);
    this.#editingReady = false;
    this.#refreshSaveState();
  }

  #refreshSaveState(): void {
    if (
      !this.#editingReady &&
      this.#synchronized &&
      this.#persisting === 0 &&
      this.#cacheWrites === 0 &&
      this.#pending.size === 0 &&
      !this.#storageError &&
      this.#text(this.input.fileId)
    ) {
      this.#editingReady = true;
    }
    let next: LiveSaveState;
    if (this.#storageError) {
      next = {
        kind: "error",
        pending: this.#pending.size + this.#persisting,
        message: this.#storageError,
      };
    } else if (this.#persisting > 0 || this.#cacheWrites > 0) {
      next = {
        kind: "saving_locally",
        pending: this.#pending.size + this.#persisting,
      };
    } else if (!this.#connected) {
      next = { kind: "offline", pending: this.#pending.size };
    } else if (!this.#synchronized || this.#pending.size > 0) {
      next = { kind: "syncing", pending: this.#pending.size };
    } else {
      next = { kind: "saved_to_team" };
    }
    this.#saveState = next;
    for (const listener of this.#statusListeners) listener();
  }
}

class LiveDocumentSession implements DocumentSession {
  readonly mode = "shared" as const;
  readonly #origin: Readonly<{ kind: string; documentId: FileId }>;
  readonly #undo: Y.UndoManager;
  readonly #listeners = new Set<DocumentChangeListener>();
  readonly #presenceListeners = new Set<() => void>();
  #transaction = 0;
  #presenceTimer: ReturnType<typeof setTimeout> | null = null;
  #materializeTimer: ReturnType<typeof setTimeout> | null = null;
  #pendingSelection: readonly [number, number] | null = null;

  constructor(
    private readonly source: LiveSource,
    readonly documentId: FileId,
    private readonly text: Y.Text,
  ) {
    this.#origin = Object.freeze({ kind: "oleafly_local", documentId });
    this.#undo = new Y.UndoManager(text, {
      trackedOrigins: new Set([this.#origin]),
      captureTimeout: 500,
    });
    text.observe(this.#observe);
  }

  destroy(): void {
    this.updateLocalSelection(null, null);
    this.text.unobserve(this.#observe);
    this.#undo.destroy();
    if (this.#presenceTimer) clearTimeout(this.#presenceTimer);
    if (this.#materializeTimer) clearTimeout(this.#materializeTimer);
  }

  snapshot(): TextSnapshot {
    return { text: this.text.toString(), version: this.source.version() };
  }

  apply(edits: readonly TextEdit[], _meta: TransactionMeta): string {
    this.source.assertEditingReady();
    validateTextEdits(edits, this.text.length);
    const transactionId = `shared:${++this.#transaction}`;
    this.source.doc.transact(() => {
      for (let index = edits.length - 1; index >= 0; index -= 1) {
        const edit = edits[index];
        if (edit.to > edit.from) this.text.delete(edit.from, edit.to - edit.from);
        if (edit.insert.length > 0) this.text.insert(edit.from, edit.insert);
      }
    }, this.#origin);
    return transactionId;
  }

  subscribe(listener: DocumentChangeListener): Unsubscribe {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  undo(): void {
    this.source.assertEditingReady();
    this.#undo.undo();
  }

  redo(): void {
    this.source.assertEditingReady();
    this.#undo.redo();
  }

  stopCapturing(): void {
    this.#undo.stopCapturing();
  }

  async captureLocalRevision(): Promise<LocalRevision> {
    return digestRevision(new TextEncoder().encode(this.text.toString()));
  }

  flushMaterialization(): Promise<void> {
    return this.source.flushMaterialization(this.documentId);
  }

  collaborators(): readonly CollaboratorSelection[] {
    return this.source.collaborators(this.documentId);
  }

  subscribeCollaborators(listener: () => void): Unsubscribe {
    this.#presenceListeners.add(listener);
    return () => this.#presenceListeners.delete(listener);
  }

  notifyCollaborators(): void {
    for (const listener of this.#presenceListeners) listener();
  }

  updateLocalSelection(anchor: number | null, head: number | null): void {
    if (anchor === null || head === null) {
      this.#pendingSelection = null;
      if (this.#presenceTimer) clearTimeout(this.#presenceTimer);
      this.#presenceTimer = null;
      this.source.sendSelection(this.documentId, null, null);
      return;
    }
    this.#pendingSelection = [anchor, head];
    if (this.#presenceTimer) return;
    this.#presenceTimer = setTimeout(() => {
      this.#presenceTimer = null;
      const selection = this.#pendingSelection;
      this.#pendingSelection = null;
      if (selection) this.source.sendSelection(this.documentId, selection[0], selection[1]);
    }, 50);
  }

  readonly #observe = (event: Y.YTextEvent, transaction: Y.Transaction): void => {
    const edits = editsFromDelta(event.delta);
    if (edits.length === 0) return;
    const source = transaction.origin === this.#origin ? "local" : "remote";
    this.source.bumpVersion();
    const change: DocumentChange = {
      transactionId: `shared:${source}:${++this.#transaction}`,
      source,
      edits,
      snapshot: this.snapshot(),
    };
    for (const listener of this.#listeners) listener(change);
    if (this.#materializeTimer) clearTimeout(this.#materializeTimer);
    this.#materializeTimer = setTimeout(() => {
      this.#materializeTimer = null;
      void this.flushMaterialization();
    }, 250);
  };
}

export function editsFromDelta(delta: readonly Y.YTextEvent["delta"][number][]): TextEdit[] {
  const edits: TextEdit[] = [];
  let oldOffset = 0;
  for (const part of delta) {
    if (part.retain) oldOffset += part.retain;
    if (part.delete) {
      edits.push({ from: oldOffset, to: oldOffset + part.delete, insert: "" });
      oldOffset += part.delete;
    }
    if (typeof part.insert === "string" && part.insert.length > 0) {
      const previous = edits.at(-1);
      if (previous && previous.to === oldOffset && previous.insert === "") {
        edits[edits.length - 1] = { ...previous, insert: part.insert };
      } else {
        edits.push({ from: oldOffset, to: oldOffset, insert: part.insert });
      }
    }
  }
  return edits;
}

function decodeAbsolutePosition(bytes: Uint8Array, doc: Y.Doc, text: Y.Text): number | null {
  try {
    const relative = Y.decodeRelativePosition(bytes);
    const absolute = Y.createAbsolutePositionFromRelativePosition(relative, doc);
    return absolute?.type === text ? absolute.index : null;
  } catch {
    return null;
  }
}

async function digestRevision(bytes: Uint8Array): Promise<LocalRevision> {
  const stableBytes = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest("SHA-256", stableBytes);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return {
    content: new TextDecoder().decode(stableBytes),
    digest: `sha256:${hex}`,
    capturedAtUnixMs: Date.now(),
  };
}

export function uuidV7(now = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let timestamp = BigInt(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = 0x70 | (bytes[6] & 0x0f);
  bytes[8] = 0x80 | (bytes[8] & 0x3f);
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
