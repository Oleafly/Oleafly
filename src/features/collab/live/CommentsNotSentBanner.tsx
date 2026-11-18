import { useId, useState } from "react";
import { MessageSquareOff, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCopyStatus } from "@/components/ui/use-copy-status";
import { WorkspaceBanner, WorkspaceBannerButton } from "@/components/ui/workspace-banner";
import type { CollabCommentNotSent } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useFilesStore } from "@/store/files";
import { CommentQuote } from "@/components/ui/comments/comment-quote";
import { useComments } from "../comments/comments-store";
import { useCommentQuoteLabels } from "../comments/desktop-comment-kit";
import { useCollabLiveStore } from "./live-store";

export function notSentText(comments: readonly CollabCommentNotSent[]): string {
  return comments
    .map((comment) => {
      const quoted = comment.quote
        ? comment.quote
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n")
        : null;
      return [comment.path, quoted, comment.body].filter(Boolean).join("\n");
    })
    .join("\n\n");
}

interface Shown {
  key: string;
  comment: CollabCommentNotSent;
  opensThread: boolean;
}

function shown(comments: readonly CollabCommentNotSent[]): Shown[] {
  const seen = new Map<string, number>();
  return comments.map((comment, at) => {
    const count = (seen.get(comment.threadId) ?? 0) + 1;
    seen.set(comment.threadId, count);
    const opensThread = at === 0 || comments[at - 1].threadId !== comment.threadId;
    return { key: `${comment.threadId}:${count}`, comment, opensThread };
  });
}

export function CommentsNotSentBanner() {
  const { t } = useTranslation(["collab", "common"]);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const { status, copy } = useCopyStatus();
  const quoteLabels = useCommentQuoteLabels();
  const projectId = useFilesStore((state) => state.projectId);
  const serverOff = useComments((state) => state.status?.serverAllowed === false);
  const comments = useCollabLiveStore((state) =>
    projectId !== null && state.projectId === projectId && !state.notSentBannerHidden ? state.commentsNotSent : null,
  );
  if (!comments) return null;
  const written = comments.length > 0;
  const message = (() => {
    if (serverOff) return written ? t(($) => $.collab.comments.notSent.writtenServer) : t(($) => $.collab.comments.notSent.changedServer);
    return written ? t(($) => $.collab.comments.notSent.written) : t(($) => $.collab.comments.notSent.changed);
  })();
  let copyLabel = t(($) => $.collab.comments.notSent.copy);
  if (status === "copied") copyLabel = t(($) => $.common.actions.copied);
  if (status === "failed") copyLabel = t(($) => $.collab.comments.notSent.copyFailed);
  const dismiss = () => {
    setOpen(false);
    useCollabLiveStore.getState().dismissCommentsNotSent();
  };
  return (
    <WorkspaceBanner tone="neutral" role="status" data-testid="collab-comments-not-sent-banner">
      <MessageSquareOff aria-hidden className="size-3.5 shrink-0" />
      <p className="min-w-0 flex-1">{message}</p>
      {written ? (
        <span className="flex shrink-0 items-center gap-1">
          <WorkspaceBannerButton
            tone="neutral"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? t(($) => $.collab.comments.notSent.hide) : t(($) => $.collab.comments.notSent.show)}
          </WorkspaceBannerButton>
          <WorkspaceBannerButton tone="neutral" onClick={() => void copy(notSentText(comments))}>
            {copyLabel}
          </WorkspaceBannerButton>
        </span>
      ) : null}
      <WorkspaceBannerButton tone="neutral" aria-label={t(($) => $.common.actions.close)} onClick={dismiss}>
        <X aria-hidden className="size-3.5" />
      </WorkspaceBannerButton>
      {written && open ? (
        <ul
          id={listId}
          aria-label={t(($) => $.collab.comments.notSent.list)}
          className="max-h-48 basis-full space-y-2 overflow-y-auto pb-1 text-foreground"
        >
          {shown(comments).map(({ key, comment, opensThread }) => (
            <li key={key} className={cn("space-y-1", opensThread && "border-t border-border pt-2")}>
              {opensThread && comment.path ? (
                <p className="truncate font-mono text-[0.6875rem] text-muted-foreground">{comment.path}</p>
              ) : null}
              {opensThread && comment.quote ? <CommentQuote quote={comment.quote} labels={quoteLabels} /> : null}
              <p className="whitespace-pre-wrap break-words">{comment.body}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </WorkspaceBanner>
  );
}
