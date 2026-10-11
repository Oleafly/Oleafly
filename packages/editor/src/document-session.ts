export interface Utf16Edit {
  from: number;
  to: number;
  insert: string;
}

export interface RemoteChange {
  edits: Utf16Edit[];
  version: number;
}

export interface DocumentSession {
  readonly path: string;
  readonly readOnly: boolean;
  version(): number;
  text(): string;
  applyLocal(edits: Utf16Edit[], baseVersion: number): void;
  subscribe(listener: (change: RemoteChange) => void): () => void;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function splitsSurrogatePair(text: string, position: number): boolean {
  return isHighSurrogate(text.charCodeAt(position - 1)) && isLowSurrogate(text.charCodeAt(position));
}

function checkEdits(text: string, edits: readonly Utf16Edit[]): void {
  let previousEnd = 0;
  for (const edit of edits) {
    if (!Number.isSafeInteger(edit.from) || !Number.isSafeInteger(edit.to)) {
      throw new RangeError("Edit offsets must be whole numbers.");
    }
    if (edit.from < previousEnd || edit.to < edit.from || edit.to > text.length) {
      throw new RangeError("Edits must be in order and inside the text.");
    }
    if (splitsSurrogatePair(text, edit.from) || splitsSurrogatePair(text, edit.to)) {
      throw new RangeError("Edits must not split a surrogate pair.");
    }
    if (edit.insert.includes("\r")) {
      throw new RangeError("Edits must use LF line breaks.");
    }
    previousEnd = edit.to;
  }
}

function applyEdits(text: string, edits: readonly Utf16Edit[]): string {
  let result = "";
  let position = 0;
  for (const edit of edits) {
    result += text.slice(position, edit.from) + edit.insert;
    position = edit.to;
  }
  return result + text.slice(position);
}

export class LocalDocumentSession implements DocumentSession {
  readonly path: string;
  readonly readOnly: boolean;
  private content: string;
  private revision = 0;
  private readonly listeners = new Set<(change: RemoteChange) => void>();

  constructor(path: string, text: string, readOnly = false) {
    this.path = path;
    this.content = text.replace(/\r\n?/gu, "\n");
    this.readOnly = readOnly;
  }

  version(): number {
    return this.revision;
  }

  text(): string {
    return this.content;
  }

  applyLocal(edits: Utf16Edit[], baseVersion: number): void {
    if (this.readOnly) throw new Error(`${this.path} is read-only.`);
    if (baseVersion !== this.revision) {
      throw new Error(
        `Edits to ${this.path} are based on version ${baseVersion}, but the document is at version ${this.revision}.`,
      );
    }
    this.apply(edits);
  }

  pushRemote(edits: Utf16Edit[]): void {
    if (!this.apply(edits)) return;
    const change: RemoteChange = { edits: edits.map((edit) => ({ ...edit })), version: this.revision };
    for (const listener of [...this.listeners]) listener(change);
  }

  subscribe(listener: (change: RemoteChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private apply(edits: readonly Utf16Edit[]): boolean {
    if (edits.length === 0) return false;
    checkEdits(this.content, edits);
    this.content = applyEdits(this.content, edits);
    this.revision += 1;
    return true;
  }
}
