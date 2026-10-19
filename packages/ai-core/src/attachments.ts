// Files attached to an AI chat. The store keeps them by content hash
// (src-tauri/src/attachments.rs); a message refers to one with an
// attachment part, which a run resolves into an image, a document or text.

export interface AttachmentMeta {
  sha256: string;
  name: string;
  mime: string;
  size: number;
  pages: number | null;
  hasText: boolean;
}

/** The message part that refers to a stored attachment. */
export interface AttachmentPartRef {
  type: "attachment";
  sha256: string;
  name: string;
  mime: string;
}

export interface AttachmentUploadMeta {
  projectId: string | null;
  name: string;
  mime: string;
}

/**
 * The raw body of an attachment upload: the header's byte length as a
 * 4-byte little-endian number, the header as UTF-8 JSON, then the file's
 * bytes. The file is sent once, as bytes, never as base64.
 */
export function encodeAttachmentUpload(meta: AttachmentUploadMeta, bytes: Uint8Array): Uint8Array {
  const header = new TextEncoder().encode(
    JSON.stringify({ projectId: meta.projectId, name: meta.name, mime: meta.mime }),
  );
  const body = new Uint8Array(4 + header.length + bytes.length);
  new DataView(body.buffer).setUint32(0, header.length, true);
  body.set(header, 4);
  body.set(bytes, 4 + header.length);
  return body;
}
