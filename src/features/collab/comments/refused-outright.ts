import type { CollabCommentErrorCode } from "@oleafly/backend-port";

export const COMMENTS_REFUSED_OUTRIGHT: readonly CollabCommentErrorCode[] = ["comment_off_server", "comment_off_project", "comment_viewer"];
