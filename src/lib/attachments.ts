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

export const ATTACHMENT_ACCEPT =
  "image/*,.pdf,.txt,.md,.tex,.typ,.bib,.cls,.sty,.bst,.csv,.tsv,.json,.yaml,.yml,.toml,.log,.xml,.html,.css,.js,.ts,.py,.r,.jl,.m,.sh,.ps1,.bat,.ipynb,.rst,.org";

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

export function attachmentGc(projectId: string, keep: readonly string[]): Promise<number> {
  return invoke<number>("attachment_gc", { projectId, keep: [...keep] });
}

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
const heldObjectUrls = new Map<string, number>();
const droppedObjectUrls = new Set<string>();

export function holdAttachmentObjectUrl(url: string): () => void {
  heldObjectUrls.set(url, (heldObjectUrls.get(url) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (heldObjectUrls.get(url) ?? 1) - 1;
    if (count > 0) {
      heldObjectUrls.set(url, count);
      return;
    }
    heldObjectUrls.delete(url);
    if (droppedObjectUrls.delete(url)) URL.revokeObjectURL(url);
  };
}

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
        if (oldUrl && heldObjectUrls.has(oldUrl)) droppedObjectUrls.add(oldUrl);
        else if (oldUrl) URL.revokeObjectURL(oldUrl);
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

export function readyAttachments(items: readonly DraftAttachment[]): DraftAttachment[] {
  return items.filter((item) => item.status === "ready" && Boolean(item.sha256));
}

function kindOf(mime: string): AttachmentKind {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  return "text";
}

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
