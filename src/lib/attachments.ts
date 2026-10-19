// The attachment store (src-tauri/src/attachments.rs): files attached to
// AI chats, kept once by content hash per project. This module stays
// small; intake and normalization load lazily (attachments-intake.ts).
import { invoke } from "@tauri-apps/api/core";
import { encodeAttachmentUpload } from "@oleafly/ai-core";
import type {
  AttachmentKind,
  DraftAttachment,
  StoredAttachmentRef,
} from "@/components/ai/composer/types";
import { i18n } from "@/i18n";
import type { AttachmentMeta } from "@/store/chats";

export interface StoredAttachmentMeta {
  sha256: string;
  name: string;
  mime: string;
  size: number;
  pages: number | null;
  hasText: boolean;
}

/** What the file picker offers: images, PDFs and text files. */
export const ATTACHMENT_ACCEPT =
  "image/*,.pdf,.txt,.md,.tex,.typ,.bib,.cls,.sty,.bst,.csv,.tsv,.json,.yaml,.yml,.toml,.log,.xml,.html,.css,.js,.ts,.py,.r,.jl,.m,.sh,.ps1,.bat,.ipynb,.rst,.org";

/** Stores a file; the bytes travel once as the raw request body. */
export function attachmentPut(
  scope: string | null,
  name: string,
  mime: string,
  bytes: Uint8Array,
): Promise<StoredAttachmentMeta> {
  return invoke<StoredAttachmentMeta>(
    "attachment_put",
    encodeAttachmentUpload({ projectId: scope, name, mime }, bytes),
  );
}

/** Stores the text read from a PDF beside it, with its page count. */
export function attachmentPutText(
  scope: string | null,
  sha256: string,
  text: string,
  pages?: number,
): Promise<StoredAttachmentMeta> {
  return invoke<StoredAttachmentMeta>("attachment_put_text", {
    projectId: scope,
    sha256,
    text,
    pages: pages ?? null,
  });
}

export function attachmentRead(scope: string | null, sha256: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("attachment_read", { projectId: scope, sha256 });
}

export function attachmentMeta(
  scope: string | null,
  sha256: string,
): Promise<StoredAttachmentMeta | null> {
  return invoke<StoredAttachmentMeta | null>("attachment_meta", { projectId: scope, sha256 });
}

/** Removes a project's stored files that `keep` does not list; returns the bytes freed. */
export function attachmentGc(projectId: string, keep: readonly string[]): Promise<number> {
  return invoke<number>("attachment_gc", { projectId, keep: [...keep] });
}

/** A stored text file as UTF-8, or null when it cannot be read. */
export async function attachmentText(scope: string | null, sha256: string): Promise<string | null> {
  try {
    const buffer = await attachmentRead(scope, sha256);
    return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  } catch {
    return null;
  }
}

const OBJECT_URL_LIMIT = 48;
const objectUrls = new Map<string, string>();
const pendingObjectUrls = new Map<string, Promise<string>>();

/**
 * An object URL for a stored file, for thumbnails and previews. The newest
 * 48 stay cached (the oldest is revoked); concurrent requests share one read.
 */
export function attachmentObjectUrl(
  scope: string | null,
  sha256: string,
  mime: string,
): Promise<string> {
  const key = `${scope ?? ""}\u0000${sha256}\u0000${mime}`;
  const cached = objectUrls.get(key);
  if (cached) {
    objectUrls.delete(key);
    objectUrls.set(key, cached);
    return Promise.resolve(cached);
  }
  const pending = pendingObjectUrls.get(key);
  if (pending) return pending;
  const promise = attachmentRead(scope, sha256)
    .then((buffer) => {
      const url = URL.createObjectURL(new Blob([buffer], { type: mime }));
      objectUrls.set(key, url);
      while (objectUrls.size > OBJECT_URL_LIMIT) {
        const oldest = objectUrls.keys().next();
        if (oldest.done) break;
        const oldUrl = objectUrls.get(oldest.value);
        objectUrls.delete(oldest.value);
        if (oldUrl) URL.revokeObjectURL(oldUrl);
      }
      return url;
    })
    .finally(() => {
      pendingObjectUrls.delete(key);
    });
  pendingObjectUrls.set(key, promise);
  return promise;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Stores a tool screenshot (a data URL) so the chat keeps a reference
 * instead of the base64 text. Null when it cannot be stored.
 */
export async function storeToolImage(
  scope: string | null,
  dataUrl: string,
): Promise<StoredAttachmentRef | null> {
  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const mime = blob.type || dataUrl.slice(5, dataUrl.indexOf(";")) || "image/png";
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const meta = await attachmentPut(
      scope,
      `tool-image.${IMAGE_EXTENSIONS[mime] ?? "png"}`,
      mime,
      bytes,
    );
    return { sha256: meta.sha256, mime: meta.mime };
  } catch {
    return null;
  }
}

/** Attachments stored and ready to send. */
export function readyAttachments(items: readonly DraftAttachment[]): DraftAttachment[] {
  return items.filter((item) => item.status === "ready" && Boolean(item.sha256));
}

function kindOf(mime: string): AttachmentKind {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  return "text";
}

/** The attachment as a saved chat message keeps it. */
export function draftToChatAttachment(draft: DraftAttachment): AttachmentMeta {
  const meta: AttachmentMeta = {
    name: draft.name,
    mediaType: draft.mime,
    sha256: draft.sha256,
    size: draft.size,
    kind: draft.kind,
  };
  if (draft.pages !== undefined) meta.pages = draft.pages;
  if (draft.hasText !== undefined) meta.hasText = draft.hasText;
  if (draft.pageImages?.length) meta.pageImages = draft.pageImages.map((page) => ({ ...page }));
  return meta;
}

/**
 * A saved message attachment back as a draft (edit and resend). Null for
 * attachments saved before 0.4.8, which kept only a name.
 */
export function chatToDraftAttachment(
  meta: AttachmentMeta,
  scope: string | null,
): DraftAttachment | null {
  if (!meta.sha256) return null;
  const draft: DraftAttachment = {
    id: crypto.randomUUID(),
    name: meta.name,
    mime: meta.mediaType,
    size: meta.size ?? 0,
    status: "ready",
    kind: meta.kind ?? kindOf(meta.mediaType),
    scope,
    sha256: meta.sha256,
  };
  if (meta.pages !== undefined) draft.pages = meta.pages;
  if (meta.hasText !== undefined) draft.hasText = meta.hasText;
  if (meta.pageImages?.length) draft.pageImages = meta.pageImages.map((page) => ({ ...page }));
  return draft;
}

/** A note under the composer when the model cannot read what is attached. */
export function attachmentNotice(
  items: readonly DraftAttachment[],
  model: { name: string; vision: boolean; nativePdf: boolean },
): string | null {
  const ready = readyAttachments(items);
  if (!model.vision && ready.some((item) => item.kind === "image")) {
    return i18n.t(($) => $.ai.attachments.visionUnsupported, { model: model.name });
  }
  if (!model.vision && !model.nativePdf) {
    const scanned = ready.find((item) => item.kind === "pdf" && item.hasText === false);
    if (scanned) {
      return i18n.t(($) => $.ai.attachments.scannedPdf, { name: scanned.name, model: model.name });
    }
  }
  return null;
}
