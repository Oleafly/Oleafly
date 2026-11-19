import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { CommentComposerLabels } from "@/components/ui/comments/comment-composer";
import type { CommentQuoteLabels } from "@/components/ui/comments/comment-quote";

export function useAnnotationComposerLabels(): CommentComposerLabels {
  const { t } = useTranslation(["preview", "common", "editor", "shell"]);
  return useMemo(
    () => ({
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
    }),
    [t],
  );
}

export function useAnnotationQuoteLabels(): CommentQuoteLabels {
  const { t } = useTranslation(["common"]);
  return useMemo(
    () => ({ showMore: t(($) => $.common.actions.showMore), showLess: t(($) => $.common.actions.showLess) }),
    [t],
  );
}
