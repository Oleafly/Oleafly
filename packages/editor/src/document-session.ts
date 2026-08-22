import type { FileId } from "@oleafly/realtime-protocol";

export type TransactionId = string;
export type Unsubscribe = () => void;

/** UTF-16 offsets, matching both CodeMirror and Y.Text. */
export interface TextEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

export interface TextSnapshot {
  readonly text: string;
  readonly version: number;
}

export interface TransactionMeta {
  readonly origin:
    | "human"
    | "suggestion_accept"
    | "version_restore"
    | "external_small_save"
    | "external_bulk_apply"
    | "import";
  readonly editSessionId?: string;
}

export interface DocumentChange {
  readonly transactionId: TransactionId;
  readonly source: "local" | "remote";
  readonly edits: readonly TextEdit[];
  readonly snapshot: TextSnapshot;
}

export type DocumentChangeListener = (change: DocumentChange) => void;

export interface LocalRevision {
  readonly content: string;
  readonly digest: `sha256:${string}`;
  readonly capturedAtUnixMs: number;
}

export interface CollaboratorSelection {
  readonly actorId: string;
  readonly replicaId: string;
  readonly displayName: string;
  readonly colorToken: string;
  readonly anchor: number;
  readonly head: number;
}

export interface DocumentSession {
  readonly documentId: FileId;
  readonly mode: "solo" | "shared";

  snapshot(): TextSnapshot;
  apply(edits: readonly TextEdit[], meta: TransactionMeta): TransactionId;
  subscribe(listener: DocumentChangeListener): Unsubscribe;

  undo(): void;
  redo(): void;
  stopCapturing(): void;

  captureLocalRevision(): Promise<LocalRevision>;
  flushMaterialization(): Promise<void>;

  /** Shared sessions expose presence; solo sessions retain the no-op defaults. */
  collaborators?(): readonly CollaboratorSelection[];
  subscribeCollaborators?(listener: () => void): Unsubscribe;
  updateLocalSelection?(anchor: number | null, head: number | null): void;
}

export interface TreeTransaction {
  readonly operations: readonly unknown[];
}

export interface ProjectSource {
  readonly mode: "solo" | "shared";
  openText(fileId: FileId): DocumentSession;
  applyTreeTransaction(tx: TreeTransaction): Promise<void>;
  captureProjectRevision(): Promise<LocalRevision>;
}

export function validateTextEdits(
  edits: readonly TextEdit[],
  documentLength: number,
): void {
  let previousTo = 0;
  for (const [index, edit] of edits.entries()) {
    if (!Number.isSafeInteger(edit.from) || !Number.isSafeInteger(edit.to)) {
      throw new Error("text edit offsets must be safe integers");
    }
    if (edit.from < 0 || edit.to < edit.from || edit.to > documentLength) {
      throw new Error("text edit is outside the document");
    }
    if (index > 0 && edit.from < previousTo) {
      throw new Error("text edits must be sorted and non-overlapping");
    }
    previousTo = edit.to;
  }
}

export function applyTextEdits(text: string, edits: readonly TextEdit[]): string {
  validateTextEdits(edits, text.length);
  let result = text;
  for (let index = edits.length - 1; index >= 0; index -= 1) {
    const edit = edits[index];
    result = `${result.slice(0, edit.from)}${edit.insert}${result.slice(edit.to)}`;
  }
  return result;
}
