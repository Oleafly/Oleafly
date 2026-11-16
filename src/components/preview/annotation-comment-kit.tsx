import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { type CommentConfirmProps, type CommentKit, CommentKitProvider } from "@/components/ui/comments/comment-kit";
import type { CommentQuoteLabels } from "@/components/ui/comments/comment-quote";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { describeError } from "@/lib/app-error";
import { formatDateTime, formatList, formatRelativeTimeFrom } from "@/lib/intl";

const NO_PRESENCE = { one: () => "", two: () => "", many: () => "" };

function Confirm(props: Readonly<CommentConfirmProps>) {
  return <ConfirmationDialog {...props} destructive />;
}

export function AnnotationCommentKit({ children }: Readonly<{ children: ReactNode }>) {
  const { t } = useTranslation(["preview", "common", "editor", "shell"]);
  const kit = useMemo<CommentKit>(
    () => ({
      labels: {
        mentionList: "",
        hereNow: "",
        cancel: t(($) => $.common.actions.cancel),
        sending: t(($) => $.preview.annotations.composer.saving),
        enter: t(($) => $.shell.keys.enter),
        notSent: t(($) => $.preview.annotations.composer.notSaved),
        retry: t(($) => $.common.actions.retry),
        format: {
          bold: t(($) => $.editor.toolbar.bold),
          italic: t(($) => $.editor.toolbar.italic),
          strike: t(($) => $.editor.toolbar.strikethrough),
          code: t(($) => $.editor.toolbar.inlineCode),
          list: t(($) => $.editor.toolbar.bulletedList),
          mention: "",
        },
        showMore: t(($) => $.common.actions.showMore),
        showLess: t(($) => $.common.actions.showLess),
        edited: "",
        deleted: "",
        edit: t(($) => $.common.actions.edit),
        editLabel: "",
        delete: t(($) => $.common.actions.delete),
        save: t(($) => $.common.actions.save),
        reply: "",
        replyLabel: "",
        replyPlaceholder: "",
        replies: () => "",
        hideReplies: "",
        lastReply: () => "",
        messageActions: "",
        resolve: "",
        reopen: "",
        send: "",
        addReaction: "",
        you: "",
        reactWith: () => "",
        reactedBy: () => "",
        deleteMessageConfirm: { title: "", description: "" },
        newBadge: "",
        waiting: "",
        copyText: "",
        discard: "",
        removed: "",
        replying: NO_PRESENCE,
      },
      now: 0,
      relative: formatRelativeTimeFrom,
      exact: formatDateTime,
      members: [],
      self: null,
      hue: () => 0,
      describeError,
      Confirm,
      nameOf: () => "",
      listNames: (names) => formatList(names, { type: "conjunction" }),
    }),
    [t],
  );
  return <CommentKitProvider value={kit}>{children}</CommentKitProvider>;
}

export function useAnnotationQuoteLabels(): CommentQuoteLabels {
  const { t } = useTranslation(["common"]);
  return useMemo(
    () => ({ showMore: t(($) => $.common.actions.showMore), showLess: t(($) => $.common.actions.showLess) }),
    [t],
  );
}
