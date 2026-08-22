import * as Y from "yjs";
import { z } from "zod";
import {
  ConflictIdSchema,
  ContentDigestSchema,
  FileIdSchema,
  type FileId,
} from "./identity";
import { AUTHORING_DOC_SCHEMA_VERSION } from "./version";
import { DEFAULT_REALTIME_LIMITS_V1, type RealtimeLimitsV1 } from "./limits";
import { assertWellFormedUtf16, normalizeNfcV17 } from "./unicode";

export const AUTHORING_ROOTS = {
  metadata: "authoring",
  nodes: "nodes",
  texts: "texts",
  binaryHeads: "binary_heads",
  conflicts: "conflicts",
} as const;

export const AUTHORING_METADATA_KEYS = {
  schemaVersion: "schema_version",
} as const;

export const AUTHORING_CONFLICT_SCHEMA_VERSION = 1 as const;

const NodeKindSchema = z.enum(["directory", "text", "binary"]);

const AUTHORING_ROOT_NAMES = new Set<string>(Object.values(AUTHORING_ROOTS));
const AUTHORING_NODE_KEYS = new Set([
  "parent_id",
  "name",
  "collision_key",
  "tombstone",
  "kind",
]);

const AuthoringNodeBaseSchema = z.object({
  fileId: FileIdSchema,
  parentId: FileIdSchema.nullable(),
  name: z.string(),
  collisionKey: z.string(),
  tombstone: z.boolean(),
}).strict();

export const AuthoringNodeSnapshotSchema = z.discriminatedUnion("kind", [
  AuthoringNodeBaseSchema.extend({ kind: z.literal("directory") }),
  AuthoringNodeBaseSchema.extend({ kind: z.literal("text"), text: z.string() }),
  AuthoringNodeBaseSchema.extend({
    kind: z.literal("binary"),
    binaryHeads: z.array(ContentDigestSchema),
  }),
]);

const ConflictBaseSchema = z.object({
  schemaVersion: z.literal(AUTHORING_CONFLICT_SCHEMA_VERSION),
  conflictId: ConflictIdSchema,
}).strict();

const PathCollisionConflictV1Schema = ConflictBaseSchema.extend({
  kind: z.literal("path_collision"),
  parentId: FileIdSchema.nullable(),
  collisionKey: z.string().min(1),
  fileIds: z.array(FileIdSchema).min(2),
});

const BinaryHeadsConflictV1Schema = ConflictBaseSchema.extend({
  kind: z.literal("binary_heads"),
  fileId: FileIdSchema,
  heads: z.array(ContentDigestSchema).min(2),
});

const DeleteVsEditConflictV1Schema = ConflictBaseSchema.extend({
  kind: z.literal("delete_vs_edit"),
  fileId: FileIdSchema,
  recoveryCopyFileId: FileIdSchema,
});

const RenameLosingNameConflictV1Schema = ConflictBaseSchema.extend({
  kind: z.literal("rename_loser"),
  fileId: FileIdSchema,
  losingName: z.string(),
  winningName: z.string(),
});

export const AuthoringConflictRecordV1Schema = z.discriminatedUnion("kind", [
  PathCollisionConflictV1Schema,
  BinaryHeadsConflictV1Schema,
  DeleteVsEditConflictV1Schema,
  RenameLosingNameConflictV1Schema,
]);

export type AuthoringNodeSnapshotV1 = z.infer<typeof AuthoringNodeSnapshotSchema>;
export type AuthoringConflictRecordV1 = z.infer<
  typeof AuthoringConflictRecordV1Schema
>;

export interface AuthoringDocSnapshotV1 {
  readonly schemaVersion: typeof AUTHORING_DOC_SCHEMA_VERSION;
  readonly nodes: readonly AuthoringNodeSnapshotV1[];
  readonly conflicts: readonly AuthoringConflictRecordV1[];
}

export interface NewAuthoringNodeV1 {
  readonly fileId: FileId;
  readonly parentId: FileId | null;
  readonly name: string;
}

export function createAuthoringDocV1(
  options?: ConstructorParameters<typeof Y.Doc>[0],
): Y.Doc {
  const doc = new Y.Doc(options);
  initializeAuthoringDocV1(doc);
  return doc;
}

export function initializeAuthoringDocV1(doc: Y.Doc): void {
  doc.transact(() => {
    const metadata = doc.getMap<unknown>(AUTHORING_ROOTS.metadata);
    const existingVersion = metadata.get(AUTHORING_METADATA_KEYS.schemaVersion);
    if (existingVersion !== undefined && existingVersion !== AUTHORING_DOC_SCHEMA_VERSION) {
      throw new Error(`unsupported AuthoringDoc schema version: ${String(existingVersion)}`);
    }
    metadata.set(AUTHORING_METADATA_KEYS.schemaVersion, AUTHORING_DOC_SCHEMA_VERSION);
    doc.getMap(AUTHORING_ROOTS.nodes);
    doc.getMap(AUTHORING_ROOTS.texts);
    doc.getMap(AUTHORING_ROOTS.binaryHeads);
    doc.getArray(AUTHORING_ROOTS.conflicts);
  }, "authoring_doc_initialize");
}

export function createDirectoryNodeV1(doc: Y.Doc, input: NewAuthoringNodeV1): void {
  createNodeV1(doc, input, "directory");
}

export function createTextNodeV1(
  doc: Y.Doc,
  input: NewAuthoringNodeV1 & { readonly text?: string },
): Y.Text {
  let text: Y.Text | undefined;
  doc.transact(() => {
    createNodeV1(doc, input, "text");
    text = new Y.Text();
    doc.getMap<unknown>(AUTHORING_ROOTS.texts).set(input.fileId, text);
    if (input.text !== undefined) text.insert(0, input.text);
  }, "authoring_node_create");
  return text as Y.Text;
}

export function createBinaryNodeV1(
  doc: Y.Doc,
  input: NewAuthoringNodeV1 & { readonly heads?: readonly string[] },
): Y.Array<string> {
  let heads: Y.Array<string> | undefined;
  doc.transact(() => {
    createNodeV1(doc, input, "binary");
    heads = new Y.Array<string>();
    doc.getMap<unknown>(AUTHORING_ROOTS.binaryHeads).set(input.fileId, heads);
    const parsed = z.array(ContentDigestSchema).parse(input.heads ?? []);
    if (parsed.length > 0) heads.push(parsed);
  }, "authoring_node_create");
  return heads as Y.Array<string>;
}

/** Marks a node deleted while retaining its stable ID and content for recovery. */
export function tombstoneAuthoringNodeV1(doc: Y.Doc, fileId: FileId): void {
  const node = doc.getMap<unknown>(AUTHORING_ROOTS.nodes).get(fileId);
  if (!(node instanceof Y.Map)) throw new Error(`AuthoringDoc node ${fileId} does not exist`);
  doc.transact(() => node.set("tombstone", true), "authoring_node_tombstone");
}

export function appendAuthoringConflictV1(
  doc: Y.Doc,
  conflict: AuthoringConflictRecordV1,
): void {
  doc.getArray<unknown>(AUTHORING_ROOTS.conflicts).push([
    AuthoringConflictRecordV1Schema.parse(conflict),
  ]);
}

export function snapshotAuthoringDocV1(doc: Y.Doc): AuthoringDocSnapshotV1 {
  validateAuthoringRootsV1(doc);
  const metadata = doc.getMap<unknown>(AUTHORING_ROOTS.metadata);
  const schemaVersion = metadata.get(AUTHORING_METADATA_KEYS.schemaVersion);
  if (schemaVersion !== AUTHORING_DOC_SCHEMA_VERSION) {
    throw new Error(`unsupported AuthoringDoc schema version: ${String(schemaVersion)}`);
  }

  const texts = doc.getMap<unknown>(AUTHORING_ROOTS.texts);
  const binaryHeads = doc.getMap<unknown>(AUTHORING_ROOTS.binaryHeads);
  const nodes: AuthoringNodeSnapshotV1[] = [];

  for (const [fileIdValue, value] of doc.getMap<unknown>(AUTHORING_ROOTS.nodes)) {
    if (!(value instanceof Y.Map)) {
      throw new Error(`AuthoringDoc node ${fileIdValue} is not a Y.Map`);
    }
    const fileId = FileIdSchema.parse(fileIdValue);
    const kind = NodeKindSchema.parse(value.get("kind"));
    const name = z.string().parse(value.get("name"));
    const collisionKey = z.string().parse(value.get("collision_key"));
    validatePortableNodeName(fileId, name, collisionKey);
    const base = {
      fileId,
      parentId: value.get("parent_id") == null
        ? null
        : FileIdSchema.parse(value.get("parent_id")),
      name,
      collisionKey,
      tombstone: z.boolean().parse(value.get("tombstone")),
    };

    if (kind === "text") {
      const text = texts.get(fileId);
      if (!(text instanceof Y.Text)) {
        throw new Error(`AuthoringDoc text node ${fileId} has no Y.Text`);
      }
      const content = text.toString();
      assertWellFormedUtf16(content, `AuthoringDoc text node ${fileId}`);
      nodes.push(AuthoringNodeSnapshotSchema.parse({ ...base, kind, text: content }));
    } else if (kind === "binary") {
      const heads = binaryHeads.get(fileId);
      if (!(heads instanceof Y.Array)) {
        throw new Error(`AuthoringDoc binary node ${fileId} has no head array`);
      }
      nodes.push(AuthoringNodeSnapshotSchema.parse({
        ...base,
        kind,
        binaryHeads: z.array(ContentDigestSchema).parse(heads.toArray()),
      }));
    } else {
      nodes.push(AuthoringNodeSnapshotSchema.parse({ ...base, kind }));
    }
  }

  nodes.sort((left, right) => compareUtf8(left.fileId, right.fileId));
  const conflicts = doc.getArray<unknown>(AUTHORING_ROOTS.conflicts).toArray()
    .map((value) => AuthoringConflictRecordV1Schema.parse(value));
  validateMaterializableTreeV1(nodes, conflicts);
  return { schemaVersion, nodes, conflicts };
}

/** Applies an untrusted update only after a clone of the resulting document validates. */
export function applyAuthoringUpdateV1(
  doc: Y.Doc,
  update: Uint8Array,
  limits: RealtimeLimitsV1 = DEFAULT_REALTIME_LIMITS_V1,
): void {
  if (!(update instanceof Uint8Array)) throw new Error("Yjs update is not a Uint8Array");
  if (update.length > limits.maxYjsUpdateBytes) {
    throw new Error("Yjs update exceeds the configured limit");
  }
  const candidate = new Y.Doc();
  candidate.getMap(AUTHORING_ROOTS.metadata);
  candidate.getMap(AUTHORING_ROOTS.nodes);
  candidate.getMap(AUTHORING_ROOTS.texts);
  candidate.getMap(AUTHORING_ROOTS.binaryHeads);
  candidate.getArray(AUTHORING_ROOTS.conflicts);
  const current = Y.encodeStateAsUpdate(doc);
  if (current.length > 0) Y.applyUpdate(candidate, current);
  Y.applyUpdate(candidate, update);
  snapshotAuthoringDocV1(candidate);
  Y.applyUpdate(doc, update);
}

export function portableCollisionKey(path: string): string {
  assertWellFormedUtf16(path, "portable path");
  const normalized = normalizeNfcV17(path.replaceAll("\\", "/"));
  return normalized.replace(
    /[A-Z]/g,
    (character) => String.fromCharCode(character.charCodeAt(0) + 32),
  );
}

export function validateMaterializableTreeV1(
  nodes: readonly AuthoringNodeSnapshotV1[],
  conflicts: readonly AuthoringConflictRecordV1[],
): void {
  const byId = new Map<FileId, AuthoringNodeSnapshotV1>();
  for (const node of nodes) {
    if (byId.has(node.fileId)) {
      throw new Error(`duplicate AuthoringDoc FileId: ${node.fileId}`);
    }
    byId.set(node.fileId, node);
    validatePortableNodeName(node.fileId, node.name, node.collisionKey);
    if (node.kind === "text") assertWellFormedUtf16(node.text, `AuthoringDoc text node ${node.fileId}`);
  }
  const conflictIds = new Set<string>();
  for (const conflict of conflicts) {
    if (conflictIds.has(conflict.conflictId)) {
      throw new Error(`duplicate AuthoringDoc conflict ID: ${conflict.conflictId}`);
    }
    conflictIds.add(conflict.conflictId);
    if (conflict.kind === "rename_loser") {
      validatePortableNodeName(conflict.fileId, conflict.losingName, portableCollisionKey(conflict.losingName));
      validatePortableNodeName(conflict.fileId, conflict.winningName, portableCollisionKey(conflict.winningName));
    }
  }

  for (const node of nodes) {
    if (node.tombstone) continue;
    if (node.parentId !== null) {
      const parent = byId.get(node.parentId);
      if (parent === undefined || parent.tombstone || parent.kind !== "directory") {
        throw new Error(`AuthoringDoc node ${node.fileId} has a missing or non-directory parent`);
      }
    }
    const visited = new Set<FileId>([node.fileId]);
    let parentId = node.parentId;
    while (parentId !== null) {
      if (visited.has(parentId)) {
        throw new Error(`AuthoringDoc node ${node.fileId} is in a parent cycle`);
      }
      visited.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
    if (node.kind === "binary" && new Set(node.binaryHeads).size !== node.binaryHeads.length) {
      throw new Error(`AuthoringDoc binary node ${node.fileId} repeats a binary head`);
    }
    if (node.kind === "binary" && node.binaryHeads.length > 1 && !conflicts.some((conflict) =>
      conflict.kind === "binary_heads" &&
      conflict.fileId === node.fileId &&
      sameStrings(conflict.heads, node.binaryHeads)
    )) {
      throw new Error(`AuthoringDoc binary node ${node.fileId} has unresolved heads without a typed conflict`);
    }
  }

  const siblings = new Map<string, FileId[]>();
  for (const node of nodes) {
    if (node.tombstone) continue;
    const key = `${node.parentId ?? "root"}\0${node.collisionKey}`;
    const values = siblings.get(key) ?? [];
    values.push(node.fileId);
    siblings.set(key, values);
  }
  for (const [key, fileIds] of siblings) {
    if (fileIds.length < 2) continue;
    const separator = key.indexOf("\0");
    const parentKey = key.slice(0, separator);
    const collisionKey = key.slice(separator + 1);
    const parentId = parentKey === "root" ? null : FileIdSchema.parse(parentKey);
    if (!conflicts.some((conflict) =>
      conflict.kind === "path_collision" &&
      conflict.parentId === parentId &&
      conflict.collisionKey === collisionKey &&
      sameStrings(conflict.fileIds, fileIds)
    )) {
      throw new Error(`active siblings collide at portable key ${collisionKey}`);
    }
  }
}

function createNodeV1(
  doc: Y.Doc,
  input: NewAuthoringNodeV1,
  kind: "directory" | "text" | "binary",
): void {
  FileIdSchema.parse(input.fileId);
  if (input.parentId !== null) FileIdSchema.parse(input.parentId);
  const collisionKey = portableCollisionKey(input.name);
  validatePortableNodeName(input.fileId, input.name, collisionKey);
  const nodes = doc.getMap<unknown>(AUTHORING_ROOTS.nodes);
  if (nodes.has(input.fileId)) throw new Error(`AuthoringDoc node ${input.fileId} already exists`);
  const node = new Y.Map<unknown>();
  node.set("parent_id", input.parentId);
  node.set("name", input.name);
  node.set("collision_key", collisionKey);
  node.set("tombstone", false);
  node.set("kind", kind);
  nodes.set(input.fileId, node);
}

function validatePortableNodeName(fileId: FileId, name: string, collisionKey: string): void {
  assertWellFormedUtf16(name, `AuthoringDoc node ${fileId} name`);
  assertWellFormedUtf16(collisionKey, `AuthoringDoc node ${fileId} collision key`);
  const invalid = name.length === 0 ||
    name !== normalizeNfcV17(name) ||
    name === "." ||
    name === ".." ||
    [...name].some((character) => isControlCharacter(character)) ||
    /[/\\<>:"|?*]/u.test(name) ||
    /[. ]$/u.test(name) ||
    isWindowsDeviceName(name);
  if (invalid) throw new Error(`AuthoringDoc node ${fileId} has an invalid portable name`);
  if (collisionKey !== portableCollisionKey(name)) {
    throw new Error(`AuthoringDoc node ${fileId} has an invalid collision key`);
  }
}

function isControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return codePoint !== undefined &&
    (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f));
}

function validateAuthoringRootsV1(doc: Y.Doc): void {
  for (const root of doc.share.keys()) {
    if (!AUTHORING_ROOT_NAMES.has(root)) {
      throw new Error(`AuthoringDoc has unknown root: ${root}`);
    }
  }
  const metadata = doc.share.get(AUTHORING_ROOTS.metadata);
  const nodes = doc.share.get(AUTHORING_ROOTS.nodes);
  const texts = doc.share.get(AUTHORING_ROOTS.texts);
  const binaryHeads = doc.share.get(AUTHORING_ROOTS.binaryHeads);
  const conflicts = doc.share.get(AUTHORING_ROOTS.conflicts);
  if (!(metadata instanceof Y.Map) || !(nodes instanceof Y.Map) ||
      !(texts instanceof Y.Map) || !(binaryHeads instanceof Y.Map) ||
      !(conflicts instanceof Y.Array)) {
    throw new Error("AuthoringDoc roots have invalid shared types");
  }
  for (const key of metadata.keys()) {
    if (key !== AUTHORING_METADATA_KEYS.schemaVersion) {
      throw new Error(`AuthoringDoc metadata has unknown key: ${key}`);
    }
  }
  const nodeKinds = new Map<string, string>();
  for (const [fileId, value] of nodes) {
    FileIdSchema.parse(fileId);
    if (!(value instanceof Y.Map)) continue;
    for (const key of value.keys()) {
      if (!AUTHORING_NODE_KEYS.has(key)) {
        throw new Error(`AuthoringDoc node ${fileId} has unknown key: ${key}`);
      }
    }
    const kind = NodeKindSchema.parse(value.get("kind"));
    nodeKinds.set(fileId, kind);
  }
  for (const [fileId, value] of texts) {
    if (nodeKinds.get(fileId) !== "text" || !(value instanceof Y.Text)) {
      throw new Error(`AuthoringDoc has orphan or invalid text root: ${fileId}`);
    }
  }
  for (const [fileId, value] of binaryHeads) {
    if (nodeKinds.get(fileId) !== "binary" || !(value instanceof Y.Array)) {
      throw new Error(`AuthoringDoc has orphan or invalid binary-head root: ${fileId}`);
    }
  }
}

function isWindowsDeviceName(name: string): boolean {
  const base = portableCollisionKey(name.split(".", 1)[0]);
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(base);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort(compareUtf8).join("\0") === [...right].sort(compareUtf8).join("\0");
}

function compareUtf8(left: string, right: string): number {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index] - rightBytes[index];
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}
