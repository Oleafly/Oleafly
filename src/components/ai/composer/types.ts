import type { ComponentType } from "react";

export type AttachmentKind = "image" | "pdf" | "text";

/** An attachment as the composer shows it. */
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
  /** Selecting replaces the text with this (skills use "/id "). */
  insertText?: string;
  /** Typing `/<command>` and then whitespace closes the menu. */
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

/** A composer attachment with what the store needs to send it. */
export interface DraftAttachment extends ComposerAttachment {
  kind: AttachmentKind;
  /** Attachment store scope: the project id, or null for the global store. */
  scope: string | null;
  /** Set once stored (status "ready"). */
  sha256?: string;
  /** PDF text stored beside the bytes. */
  hasText?: boolean;
  /** Rendered first pages of a scanned PDF. */
  pageImages?: StoredAttachmentRef[];
}
