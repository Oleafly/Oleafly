import { i18n } from "@/i18n";
import { isCollabCommentError, type CollabCommentErrorCode } from "@/lib/tauri";
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

export function commentFailure(error: unknown): string {
  if (isCollabCommentError(error)) return REFUSALS[error.code]();
  return collabErrorText(error);
}
