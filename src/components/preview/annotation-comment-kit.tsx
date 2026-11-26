import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { type CommentConfirmProps, type CommentKit, CommentKitProvider } from "@/components/ui/comments/comment-kit";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { describeError } from "@/lib/app-error";
import { formatDateTime, formatList, formatRelativeTimeFrom } from "@/lib/intl";

const NO_PRESENCE = { one: () => "", two: () => "", many: () => "" };
const ANNOTATION_COMMENT_LIMIT = 4000;

function Confirm(props: Readonly<CommentConfirmProps>) {
  return <ConfirmationDialog {...props} destructive />;
}

export function AnnotationCommentKit({ children }: Readonly<{ children: ReactNode }>) {
  const { t } = useTranslation(["annotations", "common", "editor", "shell"]);
  const kit = useMemo<CommentKit>(
    () => ({
      labels: {
        mentionList: "",
        hereNow: "",
        cancel: t(($) => $.common.actions.cancel),
        sending: t(($) => $.annotations.composer.saving),
        enter: t(($) => $.shell.keys.enter),
        notSent: t(($) => $.annotations.composer.notSaved),
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
      maxLength: ANNOTATION_COMMENT_LIMIT,
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
