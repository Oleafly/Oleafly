export interface AttachmentMeta {
  sha256: string;
  name: string;
  mime: string;
  size: number;
  pages: number | null;
  hasText: boolean;
}

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
