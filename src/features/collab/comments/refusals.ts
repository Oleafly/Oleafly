import { i18n } from "@/i18n";
import { logError } from "@/lib/log";
import type { CollabCommentErrorCode } from "@/lib/tauri";
import { isCollabCommentError } from "@/lib/tauri-collab";
import { collabErrorCode, collabErrorText } from "../errors";
import { COMMENTS_REFUSED_OUTRIGHT } from "./refused-outright";

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

const REFUSED_OUTRIGHT: ReadonlySet<CollabCommentErrorCode> = new Set(COMMENTS_REFUSED_OUTRIGHT);

export function refusedOutright(error: unknown): boolean {
  return isCollabCommentError(error) && REFUSED_OUTRIGHT.has(error.code);
}

export async function reported<T>(scope: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const code = isCollabCommentError(error) ? null : collabErrorCode(error);
    if (code === "internal" || code === "server") void logError(scope, error);
    throw error;
  }
}

export function commentRetryable(error: unknown): boolean {
  return !isCollabCommentError(error) || error.code === "comment_not_live";
}
