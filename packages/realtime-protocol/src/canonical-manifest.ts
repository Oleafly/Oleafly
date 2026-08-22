import type {
  AuthoringDocSnapshotV1,
  AuthoringNodeSnapshotV1,
} from "./authoring-doc";
import { CANONICAL_MANIFEST_SCHEMA_VERSION } from "./version";
import { AUTHORING_DOC_SCHEMA_VERSION } from "./version";

export interface CanonicalAuthoringManifestV1 {
  readonly schemaVersion: typeof CANONICAL_MANIFEST_SCHEMA_VERSION;
  readonly nodes: readonly AuthoringNodeSnapshotV1[];
  readonly conflicts: AuthoringDocSnapshotV1["conflicts"];
}

export function canonicalAuthoringManifestV1(
  snapshot: AuthoringDocSnapshotV1,
): string {
  if (snapshot.schemaVersion !== AUTHORING_DOC_SCHEMA_VERSION) {
    throw new Error(`unsupported AuthoringDoc schema version: ${snapshot.schemaVersion}`);
  }
  const nodes = [...snapshot.nodes]
    .sort((left, right) => compareUtf8(left.fileId, right.fileId))
    .map(canonicalNode);
  return JSON.stringify({
    schemaVersion: CANONICAL_MANIFEST_SCHEMA_VERSION,
    nodes,
    conflicts: snapshot.conflicts.map(canonicalJsonValue),
  });
}

function canonicalNode(node: AuthoringNodeSnapshotV1): Record<string, unknown> {
  const base: Record<string, unknown> = {
    collisionKey: node.collisionKey,
    fileId: node.fileId,
    kind: node.kind,
    name: node.name,
    parentId: node.parentId,
  };
  if (node.kind === "binary") {
    base.binaryHeads = [...node.binaryHeads].sort(compareUtf8);
  }
  if (node.kind === "text") base.text = node.text;
  base.tombstone = node.tombstone;
  return Object.fromEntries(
    Object.entries(base).sort(([left], [right]) => compareUtf8(left, right)),
  );
}

function canonicalJsonValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareUtf8(left, right));
    return Object.fromEntries(
      entries.map(([key, entry]) => [key, canonicalJsonValue(entry)]),
    );
  }
  throw new Error("canonical manifest contains a non-JSON value");
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
