import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  AUTHORING_DOC_SCHEMA_VERSION,
  AUTHORING_CONFLICT_SCHEMA_VERSION,
  AUTHORING_METADATA_KEYS,
  AUTHORING_ROOTS,
  AuthoringConflictRecordV1Schema,
  AuthoringNodeSnapshotSchema,
  CANONICAL_MANIFEST_SCHEMA_VERSION,
  ActorIdSchema,
  ClientUpdateIdSchema,
  ConflictIdSchema,
  EditSessionIdSchema,
  FileIdSchema,
  FRAME_HEADER_VERSION,
  FRAME_HEADER_LENGTH,
  ClientPresenceV1Schema,
  DEFAULT_REALTIME_LIMITS_V1,
  PendingMutationTracker,
  PROJECT_CONTROLS_SCHEMA_VERSION,
  LOCAL_PROJECT_TRANSITIONS,
  REALTIME_PROTOCOL_VERSION,
  ReplicaIdSchema,
  ROLE_CAPABILITIES,
  SERVER_PROJECT_TRANSITIONS,
  SYNC_STATUS_TRANSITIONS,
  U64Schema,
  UuidSchema,
  canonicalAuthoringManifestV1,
  applyAuthoringUpdateV1,
  createAuthoringDocV1,
  createTextNodeV1,
  decodeClientToServerFrameV1,
  decodeServerToClientFrameV1,
  encodeClientToServerFrameV1,
  encodeServerToClientFrameV1,
  negotiateHighestCommonVersion,
  portableCollisionKey,
  normalizeNfcV17,
  snapshotAuthoringDocV1,
  tombstoneAuthoringNodeV1,
  transitionLocalProject,
  transitionServerProject,
  transitionSyncStatus,
  validateMaterializableTreeV1,
  ProjectControlsSnapshotV1Schema,
  SetMainFileCommandV1Schema,
  SharedProjectBindingSchema,
} from "./index";

const fixturePath = (name: string) =>
  fileURLToPath(new URL(`../../../fixtures/realtime/${name}`, import.meta.url));

const contracts = JSON.parse(readFileSync(fixturePath("contracts-v1.json"), "utf8"));
const interop = JSON.parse(
  readFileSync(fixturePath("authoring-doc-v1.json"), "utf8"),
) as {
  yjsUpdateV1Base64: string;
  yrsUpdateV1Base64: string;
};
const canonicalFixture = readFileSync(
  fixturePath("canonical-authoring-manifest-v1.json"),
  "utf8",
).trim();
const wireFixture = JSON.parse(readFileSync(fixturePath("wire-v1.json"), "utf8")) as {
  frames: { name: string; base64: string }[];
};
const identityFixture = JSON.parse(
  readFileSync(fixturePath("identity-v1.json"), "utf8"),
) as {
  accepted: { uuid: string[]; uuidV7: string[]; u64: string[] };
  rejected: { uuid: string[]; uuidV7: string[]; u64: string[] };
};
const controlJsonFixture = JSON.parse(
  readFileSync(fixturePath("control-json-v1.json"), "utf8"),
) as {
  accepted: { projectControls: unknown[]; bindings: unknown[] };
  rejected: { projectControls: unknown[]; bindings: unknown[] };
};
const materializationFixture = JSON.parse(
  readFileSync(fixturePath("materialization-v1.json"), "utf8"),
) as {
  accepted: { nodes: unknown[]; conflicts: unknown[] }[];
  rejected: { label: string; snapshot: { nodes: unknown[]; conflicts: unknown[] } }[];
};

describe("frozen realtime contracts", () => {
  it("matches the shared version, capability, and transition fixture", () => {
    expect({
      frameHeader: FRAME_HEADER_VERSION,
      protocol: REALTIME_PROTOCOL_VERSION,
      authoringDoc: AUTHORING_DOC_SCHEMA_VERSION,
      authoringConflict: AUTHORING_CONFLICT_SCHEMA_VERSION,
      projectControls: PROJECT_CONTROLS_SCHEMA_VERSION,
      canonicalManifest: CANONICAL_MANIFEST_SCHEMA_VERSION,
    }).toEqual(contracts.versions);
    expect(ROLE_CAPABILITIES).toEqual(contracts.roleCapabilities);
    expect(LOCAL_PROJECT_TRANSITIONS).toEqual(contracts.localProjectTransitions);
    expect(SYNC_STATUS_TRANSITIONS).toEqual(contracts.syncStatusTransitions);
    expect(SERVER_PROJECT_TRANSITIONS).toEqual(contracts.serverProjectTransitions);
  });

  it("fails closed on an undefined state transition", () => {
    expect(transitionLocalProject("local", "cutover_committed")).toBeNull();
    expect(transitionLocalProject("shared_active", "leave_confirmed"))
      .toBe("shared_closed");
  });

  it("fails closed for every illegal state-machine pair", () => {
    assertTransitionMatrix(
      ["local", "sharing_staging", "sharing_cutover", "joining_bootstrap", "shared_active", "revocation_recovery", "shared_closed"] as const,
      ["begin_share", "staging_ready", "share_failed", "cutover_committed", "begin_join", "bootstrap_durable", "join_failed", "authorization_revoked", "leave_confirmed", "recovery_detached", "recovery_exported", "recovery_discarded"] as const,
      contracts.localProjectTransitions,
      transitionLocalProject,
    );
    assertTransitionMatrix(
      ["saved_locally", "syncing", "saved_to_team", "offline", "recovery_required"] as const,
      ["local_mutation", "sync_started", "durable_receipt_pending", "durable_receipt_complete", "reconciliation_complete_no_pending", "connection_lost", "authorization_rejected"] as const,
      contracts.syncStatusTransitions,
      transitionSyncStatus,
    );
    assertTransitionMatrix(
      ["staging", "active", "archived_read_only", "delete_pending", "purged"] as const,
      ["activate", "staging_expired", "archive", "schedule_delete", "cancel_delete", "grace_elapsed"] as const,
      contracts.serverProjectTransitions,
      transitionServerProject,
    );
  });

  it("uses one portable key for separators, case, and NFC", () => {
    expect(portableCollisionKey("Sections\\CAFE\u0301.tex"))
      .toBe("sections/cafÉ.tex");
    expect(portableCollisionKey("İΣß.TEX")).toBe("İΣß.tex");
    expect([...normalizeNfcV17("a\u1add\u0301")].map((value) => value.codePointAt(0)))
      .toEqual([0xe1, 0x1add]);
  });

  it("chooses the highest common protocol version", () => {
    expect(negotiateHighestCommonVersion([1, 3, 2], [4, 2, 3])).toBe(3);
    expect(negotiateHighestCommonVersion([1], [2])).toBeNull();
  });

  it("accepts only canonical lowercase identities and bounded u64 values", () => {
    for (const value of identityFixture.accepted.uuid) expect(UuidSchema.parse(value)).toBe(value);
    for (const value of identityFixture.rejected.uuid) expect(UuidSchema.safeParse(value).success).toBe(false);
    for (const value of identityFixture.accepted.uuidV7) expect(FileIdSchema.parse(value)).toBe(value);
    for (const value of identityFixture.rejected.uuidV7) expect(FileIdSchema.safeParse(value).success).toBe(false);
    for (const value of identityFixture.accepted.u64) expect(U64Schema.parse(BigInt(value))).toBe(BigInt(value));
    for (const value of identityFixture.rejected.u64) expect(U64Schema.safeParse(BigInt(value)).success).toBe(false);
  });

  it("does not let client presence claim an actor identity", () => {
    expect(ClientPresenceV1Schema.safeParse({
      selection: null,
      actorId: "a07b6610-5950-4b90-8a29-c9ea207236c8",
    }).success).toBe(false);
  });

  it("keeps main-file control out of Yjs and retains tombstoned text", () => {
    const doc = createAuthoringDocV1();
    const fileId = FileIdSchema.parse("0198cf35-0000-7000-8000-000000000020");
    createTextNodeV1(doc, { fileId, parentId: null, name: "draft.tex", text: "safe" });
    tombstoneAuthoringNodeV1(doc, fileId);
    expect(doc.getMap(AUTHORING_ROOTS.metadata).has("main_file_id")).toBe(false);
    expect(snapshotAuthoringDocV1(doc).nodes[0]).toMatchObject({
      fileId,
      tombstone: true,
      text: "safe",
    });
  });

  it("rejects non-portable names and untyped sibling collisions", () => {
    const first = FileIdSchema.parse("0198cf35-0000-7000-8000-000000000020");
    for (const name of ["", ".", "CON", "bad?.tex", "trail. ", "child/name", "bad\u0085.tex"]) {
      const doc = createAuthoringDocV1();
      expect(() => createTextNodeV1(doc, { fileId: first, parentId: null, name }))
        .toThrow(/invalid portable name/);
    }
    const second = FileIdSchema.parse("0198cf35-0000-7000-8000-000000000021");
    const doc = createAuthoringDocV1();
    createTextNodeV1(doc, { fileId: first, parentId: null, name: "README.tex" });
    createTextNodeV1(doc, { fileId: second, parentId: null, name: "readme.tex" });
    expect(() => snapshotAuthoringDocV1(doc)).toThrow(/collide/);
    doc.getArray(AUTHORING_ROOTS.conflicts).push([{
      schemaVersion: 1,
      conflictId: ConflictIdSchema.parse("0198cf35-0000-7000-8000-000000000022"),
      kind: "path_collision",
      parentId: null,
      collisionKey: "readme.tex",
      fileIds: [first, second],
    }]);
    expect(snapshotAuthoringDocV1(doc).nodes).toHaveLength(2);
  });

  it("rejects shadow controls, unknown fields, orphans, and duplicate materialization IDs", () => {
    const fileId = FileIdSchema.parse("0198cf35-0000-7000-8000-000000000020");
    const shadow = createAuthoringDocV1();
    shadow.getMap(AUTHORING_ROOTS.metadata).set("main_file_id", fileId);
    expect(() => snapshotAuthoringDocV1(shadow)).toThrow(/unknown key/);

    const unknown = createAuthoringDocV1();
    unknown.getMap("arbitrary").set("x", true);
    expect(() => snapshotAuthoringDocV1(unknown)).toThrow(/unknown.*root/);

    const orphan = createAuthoringDocV1();
    orphan.getMap(AUTHORING_ROOTS.texts).set(fileId, new Y.Text());
    expect(() => snapshotAuthoringDocV1(orphan)).toThrow(/orphan/);

    const valid = createAuthoringDocV1();
    createTextNodeV1(valid, { fileId, parentId: null, name: "valid.tex" });
    const node = snapshotAuthoringDocV1(valid).nodes[0];
    expect(() => validateMaterializableTreeV1([node, node], [])).toThrow(/duplicate/);
    const invalidName = { ...node, name: "CAFE\u0301.tex", collisionKey: "café.tex" };
    expect(() => validateMaterializableTreeV1([invalidName], [])).toThrow(/invalid portable name/);
  });

  it("matches the shared materialization accept-reject fixture", () => {
    for (const snapshot of materializationFixture.accepted) {
      expect(() => validateMaterializableTreeV1(
        snapshot.nodes.map((node) => AuthoringNodeSnapshotSchema.parse(node)),
        snapshot.conflicts.map((conflict) => AuthoringConflictRecordV1Schema.parse(conflict)),
      )).not.toThrow();
    }
    for (const { label, snapshot } of materializationFixture.rejected) {
      expect(() => validateMaterializableTreeV1(
        snapshot.nodes.map((node) => AuthoringNodeSnapshotSchema.parse(node)),
        snapshot.conflicts.map((conflict) => AuthoringConflictRecordV1Schema.parse(conflict)),
      ), label).toThrow();
    }
  });

  it("leaves authoritative state byte-identical when an untrusted update is invalid", () => {
    const authority = createAuthoringDocV1();
    const before = Y.encodeStateAsUpdate(authority);
    const attacker = new Y.Doc();
    Y.applyUpdate(attacker, before);
    attacker.getMap(AUTHORING_ROOTS.metadata).set("main_file_id", "shadow");
    const update = Y.encodeStateAsUpdate(attacker, Y.encodeStateVector(authority));
    expect(() => applyAuthoringUpdateV1(authority, update)).toThrow(/unknown key/);
    expect(Y.encodeStateAsUpdate(authority)).toEqual(before);
  });

  it("rejects ill-formed UTF-16 strings", () => {
    const fileId = FileIdSchema.parse("0198cf35-0000-7000-8000-000000000020");
    expect(() => createTextNodeV1(createAuthoringDocV1(), {
      fileId,
      parentId: null,
      name: `bad${String.fromCharCode(0xd800)}.tex`,
    })).toThrow(/surrogate/);
  });
});

describe("binary WebSocket framing v1", () => {
  it("matches the cross-language golden bytes and round-trips every first-slice message", () => {
    const frames = buildWireFixtureFrames();
    expect(frames.map((entry) => entry.name)).toEqual(wireFixture.frames.map((entry) => entry.name));
    for (const [index, entry] of frames.entries()) {
      const encoded = encodeFixtureFrame(entry);
      expect(encodeBase64(encoded)).toBe(wireFixture.frames[index].base64);
      expect(roundTripFixtureFrame(entry.direction, encoded)).toEqual(encoded);
      expect(roundTripFixtureFrame(
        entry.direction,
        decodeBase64(wireFixture.frames[index].base64),
      )).toEqual(encoded);
    }
  });

  it("keeps syncing until every exact pending mutation is acknowledged", () => {
    const frames = buildWireFixtureFrames();
    const mutation = frames.find((entry) => entry.name === "mutation_with_assistance")?.frame;
    const receipt = frames.find((entry) => entry.name === "durable_receipt")?.frame;
    if (mutation?.message.kind !== "mutation" || receipt?.message.kind !== "durable_receipt") {
      throw new Error("wire fixture is missing mutation or receipt");
    }
    const tracker = new PendingMutationTracker();
    tracker.add(mutation.message.envelope);
    expect(tracker.add(mutation.message.envelope)).toBe(false);
    expect(() => tracker.add({
      ...mutation.message.envelope,
      replicaId: ReplicaIdSchema.parse("0198cf35-0000-7000-8000-000000000099"),
    })).toThrow(/different mutation identity/);
    tracker.add({
      clientUpdateId: ClientUpdateIdSchema.parse("0198cf35-0000-7000-8000-000000000013"),
      replicaId: mutation.message.envelope.replicaId,
      clientSequence: 2n,
    });
    expect(tracker.acknowledge(receipt.message.receipt)).toBe(true);
    expect(tracker.count).toBe(1);
    expect(tracker.isSavedToTeam).toBe(false);
  });

  it("requires a 256-bit opening ticket and rejects forged presence identity", () => {
    expect(() => encodeClientToServerFrameV1({
      protocolVersion: 0,
      message: {
        kind: "opening_auth",
        supportedVersions: [1],
        ticket: new Uint8Array(31),
      },
    })).toThrow(/32 bytes/);
    expect(ClientPresenceV1Schema.safeParse({
      selection: null,
      actorId: "a07b6610-5950-4b90-8a29-c9ea207236c8",
    }).success).toBe(false);
  });

  it("rejects forged frames in the wrong direction and raw client broadcasts", () => {
    const frames = buildWireFixtureFrames();
    const receipt = encodeFixtureFrame(frames.find((entry) => entry.name === "durable_receipt") as (typeof frames)[number]);
    expect(() => decodeClientToServerFrameV1(receipt)).toThrow(/not a client-to-server/);
    const presence = encodeFixtureFrame(frames.find((entry) => entry.name === "server_presence") as (typeof frames)[number]);
    expect(() => decodeClientToServerFrameV1(presence)).toThrow(/not a client-to-server/);
    const stateVector = encodeFixtureFrame(frames.find((entry) => entry.name === "yjs_state_vector") as (typeof frames)[number]);
    const forged = stateVector.slice();
    forged[FRAME_HEADER_LENGTH] = 2;
    expect(() => decodeClientToServerFrameV1(forged)).toThrow(/state-vector/);
  });

  it("enforces configured limits at the boundary before copying fields", () => {
    const mutation = buildWireFixtureFrames().find((entry) => entry.name === "mutation_without_assistance");
    if (mutation?.frame.message.kind !== "mutation") throw new Error("missing mutation fixture");
    const limits = { ...DEFAULT_REALTIME_LIMITS_V1, maxMutationUpdateBytes: mutation.frame.message.envelope.update.length };
    expect(() => encodeClientToServerFrameV1(mutation.frame, limits)).not.toThrow();
    expect(() => encodeClientToServerFrameV1({
      ...mutation.frame,
      message: { ...mutation.frame.message, envelope: {
        ...mutation.frame.message.envelope,
        update: new Uint8Array(limits.maxMutationUpdateBytes + 1),
      } },
    }, limits)).toThrow(/mutation update.*limit/);
    const encoded = encodeClientToServerFrameV1(mutation.frame, limits);
    expect(() => decodeClientToServerFrameV1(encoded, {
      maxYjsUpdateBytes: mutation.frame.message.envelope.update.length,
      maxYjsStateVectorBytes: 1,
      maxMutationUpdateBytes: mutation.frame.message.envelope.update.length,
      maxRelativePositionBytes: 1,
      maxStringBytes: 1,
      maxAssistanceAcceptedDiffBytes: 1,
      maxFrameBytes: encoded.length - 1,
    })).toThrow(/frame.*limit/);
  });

  it("uses strict canonical decimal strings in JSON controls and bindings", () => {
    for (const value of controlJsonFixture.accepted.projectControls) {
      const schema = (value as { kind?: string }).kind === "set_main_file"
        ? SetMainFileCommandV1Schema
        : ProjectControlsSnapshotV1Schema;
      expect(schema.safeParse(value).success).toBe(true);
    }
    for (const value of controlJsonFixture.rejected.projectControls) {
      const schema = (value as { kind?: string }).kind === "set_main_file"
        ? SetMainFileCommandV1Schema
        : ProjectControlsSnapshotV1Schema;
      expect(schema.safeParse(value).success).toBe(false);
    }
    for (const value of controlJsonFixture.accepted.bindings) {
      expect(SharedProjectBindingSchema.safeParse(value).success).toBe(true);
    }
    for (const value of controlJsonFixture.rejected.bindings) {
      expect(SharedProjectBindingSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("Yjs and yrs AuthoringDoc v1 interoperability", () => {
  it("reads Yjs then yrs updates and produces the canonical manifest", () => {
    const doc = emptyTypedDoc();
    Y.applyUpdate(doc, decodeBase64(interop.yjsUpdateV1Base64));
    Y.applyUpdate(doc, decodeBase64(interop.yrsUpdateV1Base64));

    const snapshot = snapshotAuthoringDocV1(doc);
    expect(snapshot.nodes).toHaveLength(5);
    expect(snapshot.nodes.find((node) => node.fileId.endsWith("0006"))?.tombstone)
      .toBe(true);
    expect(snapshot.nodes[0]).toMatchObject({
      kind: "text",
      text: expect.stringContaining("🌿 edited by yrs"),
    });
    expect(canonicalAuthoringManifestV1(snapshot)).toBe(canonicalFixture);
  });

  it("converges when updates are duplicated and received out of order", () => {
    const doc = emptyTypedDoc();
    const yjsUpdate = decodeBase64(interop.yjsUpdateV1Base64);
    const yrsUpdate = decodeBase64(interop.yrsUpdateV1Base64);
    Y.applyUpdate(doc, yrsUpdate);
    Y.applyUpdate(doc, yjsUpdate);
    Y.applyUpdate(doc, yrsUpdate);
    Y.applyUpdate(doc, yjsUpdate);

    expect(canonicalAuthoringManifestV1(snapshotAuthoringDocV1(doc)))
      .toBe(canonicalFixture);
  });

  it("recreates the checked-in Yjs update byte for byte", () => {
    expect(encodeBase64(buildYjsFixtureUpdate()))
      .toBe(interop.yjsUpdateV1Base64);
  });
});

function emptyTypedDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap(AUTHORING_ROOTS.metadata);
  doc.getMap(AUTHORING_ROOTS.nodes);
  doc.getMap(AUTHORING_ROOTS.texts);
  doc.getMap(AUTHORING_ROOTS.binaryHeads);
  doc.getArray(AUTHORING_ROOTS.conflicts);
  return doc;
}

function assertTransitionMatrix<State extends string, Event extends string>(
  states: readonly State[],
  events: readonly Event[],
  expected: readonly { from: State; event: Event; to: State }[],
  transition: (state: State, event: Event) => State | null,
): void {
  for (const state of states) {
    for (const event of events) {
      const target = expected.find((entry) => entry.from === state && entry.event === event)?.to ?? null;
      expect(transition(state, event), `${state} + ${event}`).toBe(target);
    }
  }
}

function buildYjsFixtureUpdate(): Uint8Array {
  const ids = {
    main: "0198cf35-0000-7000-8000-000000000002",
    sections: "0198cf35-0000-7000-8000-000000000003",
    section: "0198cf35-0000-7000-8000-000000000004",
    deleted: "0198cf35-0000-7000-8000-000000000006",
    conflict: "0198cf35-0000-7000-8000-000000000007",
  };
  const doc = new Y.Doc({ guid: "authoring-interop-v1" });
  doc.clientID = 101;
  const metadata = doc.getMap(AUTHORING_ROOTS.metadata);
  const nodes = doc.getMap<unknown>(AUTHORING_ROOTS.nodes);
  const texts = doc.getMap<unknown>(AUTHORING_ROOTS.texts);
  doc.getMap(AUTHORING_ROOTS.binaryHeads);
  const conflicts = doc.getArray(AUTHORING_ROOTS.conflicts);
  doc.transact(() => {
    metadata.set(AUTHORING_METADATA_KEYS.schemaVersion, 1);
    addTextNode(nodes, texts, ids.main, null, "main.tex", "main.tex",
      "\\documentclass{article}\n\\begin{document}\nHello 🌿\n\\end{document}\n");

    const directory = new Y.Map<unknown>();
    directory.set("parent_id", null);
    directory.set("name", "Sections");
    directory.set("collision_key", "sections");
    directory.set("tombstone", false);
    directory.set("kind", "directory");
    nodes.set(ids.sections, directory);
    addTextNode(nodes, texts, ids.section, ids.sections, "café.tex", "café.tex",
      "Café notes.\n");
    addTextNode(nodes, texts, ids.deleted, null, "scratch.tex", "scratch.tex",
      "Deleted but recoverable.\n");
    const deleted = nodes.get(ids.deleted);
    if (!(deleted instanceof Y.Map)) throw new Error("deleted fixture node missing");
    deleted.set("tombstone", true);
    conflicts.push([{
      schemaVersion: 1,
      conflictId: ids.conflict,
      kind: "rename_loser",
      fileId: ids.section,
      losingName: "Cafe.tex",
      winningName: "café.tex",
    }]);
  });
  return Y.encodeStateAsUpdate(doc);
}

function addTextNode(
  nodes: Y.Map<unknown>,
  texts: Y.Map<unknown>,
  fileId: string,
  parentId: string | null,
  name: string,
  collisionKey: string,
  content: string,
): void {
  const node = new Y.Map<unknown>();
  node.set("parent_id", parentId);
  node.set("name", name);
  node.set("collision_key", collisionKey);
  node.set("tombstone", false);
  node.set("kind", "text");
  nodes.set(fileId, node);
  const text = new Y.Text();
  texts.set(fileId, text);
  text.insert(0, content);
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

function encodeBase64(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}

function buildWireFixtureFrames() {
  const clientUpdateId = ClientUpdateIdSchema.parse("0198cf35-0000-7000-8000-000000000010");
  const replicaId = ReplicaIdSchema.parse("0198cf35-0000-7000-8000-000000000011");
  const editSessionId = EditSessionIdSchema.parse("0198cf35-0000-7000-8000-000000000012");
  const fileId = FileIdSchema.parse("0198cf35-0000-7000-8000-000000000002");
  const source = new Y.Doc();
  source.clientID = 404;
  Y.applyUpdate(source, buildYjsFixtureUpdate());
  const mainText = source.getMap<unknown>(AUTHORING_ROOTS.texts).get(fileId);
  if (!(mainText instanceof Y.Text)) throw new Error("wire fixture main text is missing");
  const initialStateVector = new Uint8Array(Y.encodeStateVector(source));
  const syncUpdate = new Uint8Array(buildYjsFixtureUpdate());
  const anchorRelativePosition = new Uint8Array(Y.encodeRelativePosition(
    Y.createRelativePositionFromTypeIndex(mainText, 8),
  ));
  const headRelativePosition = new Uint8Array(Y.encodeRelativePosition(
    Y.createRelativePositionFromTypeIndex(mainText, 24),
  ));
  const mutationBase = Y.encodeStateVector(source);
  mainText.insert(8, "live ");
  const mutationUpdate = new Uint8Array(Y.encodeStateAsUpdate(source, mutationBase));
  const selection = {
    fileId,
    anchorRelativePosition,
    headRelativePosition,
  };
  return [
    {
      name: "opening_auth",
      direction: "client",
      frame: {
        protocolVersion: 0,
        message: {
          kind: "opening_auth",
          supportedVersions: [3, 1, 2],
          ticket: Uint8Array.from({ length: 32 }, (_, index) => index),
        },
      },
    },
    { name: "opening_accepted", direction: "server", frame: { protocolVersion: 1, message: { kind: "opening_accepted" } } },
    {
      name: "yjs_state_vector",
      direction: "client",
      frame: {
        protocolVersion: 1,
        message: { kind: "yjs_sync", syncKind: "state_vector", payload: initialStateVector },
      },
    },
    {
      name: "yjs_sync_update",
      direction: "server",
      frame: {
        protocolVersion: 1,
        message: { kind: "yjs_sync", syncKind: "sync_update", payload: syncUpdate },
      },
    },
    {
      name: "yjs_broadcast",
      direction: "server",
      frame: {
        protocolVersion: 1,
        message: { kind: "yjs_sync", syncKind: "broadcast", payload: mutationUpdate },
      },
    },
    {
      name: "mutation_without_assistance",
      direction: "client",
      frame: {
        protocolVersion: 1,
        message: {
          kind: "mutation",
          envelope: {
            clientUpdateId: ClientUpdateIdSchema.parse("0198cf35-0000-7000-8000-000000000013"),
            replicaId,
            clientSequence: 1n,
            editSessionId,
            origin: "human",
            update: mutationUpdate,
          },
        },
      },
    },
    {
      name: "mutation_with_assistance",
      direction: "client",
      frame: {
        protocolVersion: 1,
        message: {
          kind: "mutation",
          envelope: {
            clientUpdateId,
            replicaId,
            clientSequence: 18_446_744_073_709_551_615n,
            editSessionId,
            origin: "human",
            assistance: {
              provider: "openai",
              model: "gpt-test",
              proposalIdentifier: "proposal-fern",
              acceptedDiff: "+Hello 🌿\n",
            },
            update: mutationUpdate,
          },
        },
      },
    },
    {
      name: "durable_receipt",
      direction: "server",
      frame: {
        protocolVersion: 1,
        message: {
          kind: "durable_receipt",
          receipt: {
            clientUpdateId,
            replicaId,
            clientSequence: 18_446_744_073_709_551_615n,
            serverSequence: 9_007_199_254_740_993n,
            authorizationEpoch: 42n,
            committedAtUnixMs: 1_770_000_000_123n,
          },
        },
      },
    },
    { name: "client_presence", direction: "client", frame: { protocolVersion: 1, message: { kind: "client_presence", presence: { selection } } } },
    { name: "client_presence_cleared", direction: "client", frame: { protocolVersion: 1, message: { kind: "client_presence", presence: { selection: null } } } },
    {
      name: "server_presence",
      direction: "server",
      frame: {
        protocolVersion: 1,
        message: {
          kind: "server_presence",
          presence: {
            actorId: ActorIdSchema.parse("a07b6610-5950-4b90-8a29-c9ea207236c8"),
            replicaId,
            displayName: "Alice 🌿",
            colorToken: "fern",
            selection,
          },
        },
      },
    },
    {
      name: "server_presence_cleared",
      direction: "server",
      frame: {
        protocolVersion: 1,
        message: {
          kind: "server_presence",
          presence: {
            actorId: ActorIdSchema.parse("a07b6610-5950-4b90-8a29-c9ea207236c8"),
            replicaId,
            displayName: "Alice 🌿",
            colorToken: "fern",
            selection: null,
          },
        },
      },
    },
  ] as const;
}

function encodeFixtureFrame(entry: ReturnType<typeof buildWireFixtureFrames>[number]): Uint8Array {
  return entry.direction === "client"
    ? encodeClientToServerFrameV1(entry.frame as Parameters<typeof encodeClientToServerFrameV1>[0])
    : encodeServerToClientFrameV1(entry.frame as Parameters<typeof encodeServerToClientFrameV1>[0]);
}

function roundTripFixtureFrame(direction: "client" | "server", bytes: Uint8Array): Uint8Array {
  return direction === "client"
    ? encodeClientToServerFrameV1(decodeClientToServerFrameV1(bytes))
    : encodeServerToClientFrameV1(decodeServerToClientFrameV1(bytes));
}
