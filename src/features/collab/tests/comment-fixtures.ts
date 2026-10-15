import type {
  CollabCommentMessage,
  CollabCommentsStatus,
  CollabCommentThread,
  CollabCommentThreadList,
} from "@/lib/tauri";
import { ALICE_ID, BOB_ID } from "./fixtures";

export const INTRO_FILE = "file-intro";
export const AT = 1_760_000_000_000;

export function commentMessage(
  id: string,
  author: string = BOB_ID,
  body = "Is this right?",
  overrides: Partial<CollabCommentMessage> = {},
): CollabCommentMessage {
  return { id, author, at: AT, body, editedAt: null, deleted: false, mentions: [], verified: true, ...overrides };
}

export function commentThread(
  id: string,
  range: { from: number; to: number } | null,
  overrides: Partial<CollabCommentThread> = {},
): CollabCommentThread {
  return {
    id,
    fileId: INTRO_FILE,
    anchor: { quote: `quote of ${id}`, range },
    createdBy: BOB_ID,
    createdAt: AT,
    resolved: null,
    messages: [commentMessage(`${id}-first`)],
    verified: true,
    ...overrides,
  };
}

export function threadList(threads: CollabCommentThread[], rev: number | null = null): CollabCommentThreadList {
  return { rev, threads };
}

export function commentsStatus(overrides: Partial<CollabCommentsStatus> = {}): CollabCommentsStatus {
  return { serverAllowed: true, projectEnabled: true, canComment: true, ...overrides };
}

export const SELF = ALICE_ID;
