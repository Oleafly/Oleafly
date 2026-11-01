import type { ComponentType } from "react";

export type AttachmentKind = "image" | "pdf" | "text";

export interface ComposerAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  pages?: number;
  thumbnailUrl?: string;
  status: "ready" | "processing" | "error";
  error?: string;
}

export interface SlashItem {
  id: string;
  label: string;
  description?: string;
  hint?: string;
  icon?: ComponentType<{ className?: string }>;
  group?: string;
  keywords?: string;
  insertText?: string;
  command?: string;
}

export interface MentionItem {
  id: string;
  label: string;
  kind: "file" | "folder" | "agent";
  path?: string;
  detail?: string;
}

export interface StoredAttachmentRef {
  sha256: string;
  mime: string;
}

export interface DraftAttachment extends ComposerAttachment {
  kind: AttachmentKind;
  scope: string | null;
  sha256?: string;
  hasText?: boolean;
  pageImages?: StoredAttachmentRef[];
}
