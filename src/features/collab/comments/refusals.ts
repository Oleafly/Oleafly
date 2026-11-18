import { i18n } from "@/i18n";
import type { CollabCommentErrorCode } from "@/lib/tauri";
import { isCollabCommentError } from "@/lib/tauri-collab";
import { collabErrorText } from "../errors";

const REFUSALS: Readonly<Record<CollabCommentErrorCode, () => string>> = {
  comment_not_live: () => i18n.t(($) => $.collab.comments.refusals.notLive),
  comment_not_yours: () => i18n.t(($) => $.collab.comments.refusals.notYours),
  comment_off_server: () => i18n.t(($) => $.collab.comments.refusals.offServer),
  comment_off_project: () => i18n.t(($) => $.collab.comments.refusals.offProject),
  comment_viewer: () => i18n.t(($) => $.collab.comments.refusals.viewer),
  comment_someone_replied: () => i18n.t(($) => $.collab.comments.refusals.someoneReplied),
  comment_message_deleted: () => i18n.t(($) => $.collab.comments.refusals.messageDeleted),
  comment_selection_changed: () => i18n.t(($) => $.collab.comments.refusals.selectionChanged),
  comment_too_long: () => i18n.t(($) => $.collab.comments.refusals.tooLong),
  comment_empty: () => i18n.t(($) => $.collab.comments.refusals.empty),
};

export function refusalText(code: CollabCommentErrorCode): string {
  return REFUSALS[code]();
}

export function commentFailure(error: unknown): string {
  if (isCollabCommentError(error)) return REFUSALS[error.code]();
  return collabErrorText(error);
}

const REFUSED_OUTRIGHT: ReadonlySet<CollabCommentErrorCode> = new Set(["comment_off_server", "comment_off_project", "comment_viewer"]);

export function refusedOutright(error: unknown): boolean {
  return isCollabCommentError(error) && REFUSED_OUTRIGHT.has(error.code);
}

export function commentRetryable(error: unknown): boolean {
  return !isCollabCommentError(error) || error.code === "comment_not_live";
}
