import { openCommentThread } from "@/components/collab/comments-rail";
import { logError } from "@/lib/log";
import { collabCommentFilePath } from "@/lib/tauri-collab";
import { useComments } from "../comments/comments-store";
import type { CommentTarget } from "./app-link";

const READY_LIMIT_MS = 15_000;

function commentsOpenFor(projectId: string): Promise<boolean> {
  if (useComments.getState().projectId === projectId) return Promise.resolve(true);
  return new Promise((resolve) => {
    let stop: () => void = () => undefined;
    const timer = window.setTimeout(() => {
      stop();
      resolve(false);
    }, READY_LIMIT_MS);
    stop = useComments.subscribe((state) => {
      if (state.projectId !== projectId) return;
      window.clearTimeout(timer);
      stop();
      resolve(true);
    });
  });
}

export async function openLinkedComment(projectId: string, comment: CommentTarget): Promise<void> {
  let path: string | null;
  try {
    path = await collabCommentFilePath(projectId, comment.fileId);
  } catch (error) {
    void logError("collab comment link", error);
    return;
  }
  if (!path || !(await commentsOpenFor(projectId))) return;
  openCommentThread(path, comment.threadId);
}
