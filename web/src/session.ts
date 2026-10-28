import type { Utf16Edit } from "@oleafly/editor/document-session";
import { RemoteDocumentSession, type RemoteSessionOptions } from "@/features/collab/live/remote-session";

export interface SessionEdit {
  edits: readonly Utf16Edit[];
  before: string;
  local: boolean;
}

export class WebDocumentSession extends RemoteDocumentSession {
  readonly fileId: string;
  private readonly editListeners = new Set<(edit: SessionEdit) => void>();
  private previous: string;

  constructor(fileId: string, path: string, text: string, options: RemoteSessionOptions) {
    super(path, text, options);
    this.fileId = fileId;
    this.previous = text;
    super.subscribe((change) => {
      const before = this.previous;
      this.previous = this.text();
      this.emit({ edits: change.edits, before, local: false });
    });
  }

  override applyLocal(edits: Utf16Edit[], baseVersion: number): void {
    const before = this.text();
    const version = this.version();
    super.applyLocal(edits, baseVersion);
    if (this.version() === version) return;
    this.previous = this.text();
    this.emit({ edits: edits.map((edit) => ({ ...edit })), before, local: true });
  }

  onEdit(listener: (edit: SessionEdit) => void): () => void {
    this.editListeners.add(listener);
    return () => {
      this.editListeners.delete(listener);
    };
  }

  private emit(edit: SessionEdit): void {
    for (const listener of Array.from(this.editListeners)) listener(edit);
  }
}
