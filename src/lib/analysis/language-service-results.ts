import {
  TextPositionIndex,
  type Position,
  type PositionEncoding,
} from "@/lib/language-service";

export interface OffsetRange {
  from: number;
  to: number;
}

export interface OffsetEdit extends OffsetRange {
  insert: string;
}

export interface LanguageServiceLocation {
  uri: string;
  range: { start: Position; end: Position };
}

export type WorkspaceEditOperation =
  | {
      kind: "edit";
      uri: string;
      edits: ReadonlyArray<{ range: LanguageServiceLocation["range"]; newText: string }>;
    }
  | { kind: "rename"; oldUri: string; newUri: string };

export interface ParsedWorkspaceEdit {
  operations: WorkspaceEditOperation[];
  unsupported: boolean;
}

export const isRecord = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isPosition(value: unknown): value is Position {
  return (
    isRecord(value) &&
    typeof value.line === "number" &&
    Number.isSafeInteger(value.line) &&
    value.line >= 0 &&
    typeof value.character === "number" &&
    Number.isSafeInteger(value.character) &&
    value.character >= 0
  );
}

export function isLspRange(
  value: unknown,
): value is LanguageServiceLocation["range"] {
  return isRecord(value) && isPosition(value.start) && isPosition(value.end);
}

export function strictOffset(
  index: TextPositionIndex,
  position: Position,
  encoding: PositionEncoding,
): number | null {
  if (
    position.line < 0 ||
    position.line >= index.lineCount ||
    position.character < 0
  ) {
    return null;
  }
  const offset = index.positionToOffset(position, encoding);
  const roundTrip = index.offsetToPosition(offset, encoding);
  return roundTrip.line === position.line &&
    roundTrip.character === position.character
    ? offset
    : null;
}

export function offsetRange(
  value: unknown,
  index: TextPositionIndex,
  encoding: PositionEncoding,
): OffsetRange | null {
  if (!isLspRange(value)) return null;
  const from = strictOffset(index, value.start, encoding);
  const to = strictOffset(index, value.end, encoding);
  return from !== null && to !== null && to >= from ? { from, to } : null;
}

export function editsOverlap(edits: readonly OffsetRange[]): boolean {
  const sorted = [...edits].sort(
    (left, right) => left.from - right.from || left.to - right.to,
  );
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (
      current.from < previous.to ||
      (current.from === previous.from && current.to === previous.to)
    ) {
      return true;
    }
  }
  return false;
}

export function offsetEdits(
  value: unknown,
  text: string,
  encoding: PositionEncoding,
): OffsetEdit[] | null {
  if (value === null) return [];
  if (!Array.isArray(value)) return null;
  const index = new TextPositionIndex(text);
  const edits: OffsetEdit[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.newText !== "string") return null;
    const range = offsetRange(item.range, index, encoding);
    if (!range) return null;
    edits.push({ ...range, insert: item.newText });
  }
  return editsOverlap(edits) ? null : edits;
}

export function applyOffsetEdits(
  text: string,
  edits: readonly OffsetEdit[],
): string {
  let next = text;
  for (const edit of [...edits].sort((left, right) => right.from - left.from)) {
    next = `${next.slice(0, edit.from)}${edit.insert}${next.slice(edit.to)}`;
  }
  return next;
}

function locationFromValue(value: unknown): LanguageServiceLocation | null {
  if (!isRecord(value)) return null;
  if (typeof value.uri === "string" && isLspRange(value.range)) {
    return { uri: value.uri, range: value.range };
  }
  if (typeof value.targetUri === "string") {
    const range = isLspRange(value.targetSelectionRange)
      ? value.targetSelectionRange
      : value.targetRange;
    if (isLspRange(range)) return { uri: value.targetUri, range };
  }
  return null;
}

export function locationsFromValue(value: unknown): LanguageServiceLocation[] {
  const items = Array.isArray(value) ? value : [value];
  const locations: LanguageServiceLocation[] = [];
  for (const item of items) {
    const location = locationFromValue(item);
    if (location) locations.push(location);
  }
  return locations;
}

function decodedPath(uri: string): string | null {
  if (!uri.startsWith("file://")) return null;
  try {
    const path = decodeURIComponent(uri.slice("file://".length));
    return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
  } catch {
    return null;
  }
}

function comparablePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
  return /^[A-Za-z]:\//.test(normalized)
    ? `${normalized[0].toLowerCase()}${normalized.slice(1)}`
    : normalized;
}

export function projectPathForUri(
  workspaceRoot: string,
  uri: string,
): string | null {
  const absolute = decodedPath(uri);
  if (absolute === null) return null;
  const root = comparablePath(workspaceRoot);
  const path = comparablePath(absolute);
  if (!path.startsWith(`${root}/`)) return null;
  const relative = path.slice(root.length + 1);
  if (!relative || relative.split("/").some((part) => part === "..")) {
    return null;
  }
  return relative;
}

function editOperation(
  uri: string,
  value: unknown,
): WorkspaceEditOperation | null {
  if (!Array.isArray(value)) return null;
  const edits: Array<{ range: LanguageServiceLocation["range"]; newText: string }> = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.newText !== "string" ||
      !isLspRange(item.range)
    ) {
      return null;
    }
    edits.push({ range: item.range, newText: item.newText });
  }
  return { kind: "edit", uri, edits };
}

function documentChangeOperation(
  value: unknown,
): WorkspaceEditOperation | "unsupported" | null {
  if (!isRecord(value)) return null;
  if (isRecord(value.textDocument) && typeof value.textDocument.uri === "string") {
    return editOperation(value.textDocument.uri, value.edits);
  }
  if (
    value.kind === "rename" &&
    typeof value.oldUri === "string" &&
    typeof value.newUri === "string"
  ) {
    return { kind: "rename", oldUri: value.oldUri, newUri: value.newUri };
  }
  if (value.kind === "create" || value.kind === "delete") {
    return "unsupported";
  }
  return null;
}

export function workspaceEditFromValue(
  value: unknown,
): ParsedWorkspaceEdit | null {
  if (!isRecord(value)) return null;
  const operations: WorkspaceEditOperation[] = [];
  let unsupported = false;
  if (Array.isArray(value.documentChanges)) {
    for (const change of value.documentChanges) {
      const operation = documentChangeOperation(change);
      if (operation === "unsupported") {
        unsupported = true;
        continue;
      }
      if (!operation) return null;
      operations.push(operation);
    }
    return { operations, unsupported };
  }
  if (isRecord(value.changes)) {
    for (const [uri, edits] of Object.entries(value.changes)) {
      const operation = editOperation(uri, edits);
      if (!operation) return null;
      operations.push(operation);
    }
    return { operations, unsupported };
  }
  return { operations, unsupported };
}
