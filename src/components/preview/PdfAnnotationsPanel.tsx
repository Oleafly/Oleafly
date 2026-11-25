import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCheck, Crosshair, MessageSquareText, RotateCcw, Trash2 } from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FloatingSidePanel } from "@/components/ui/floating-side-panel";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { CommentBody } from "@/components/ui/comments/comment-body";
import { CommentComposer } from "@/components/ui/comments/comment-composer";
import { CommentQuote } from "@/components/ui/comments/comment-quote";
import { lineSpan } from "@/features/pdf-annotations/model";
import type { PdfAnnotation, PdfAnnotationStatus } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { confirmAction } from "@/store/confirm-dialog";
import { usePdfAnnotationsStore } from "@/store/pdf-annotations";
import { AnnotationCommentKit, useAnnotationQuoteLabels } from "./annotation-comment-kit";

const STATUS_VARIANT: Record<PdfAnnotationStatus, BadgeVariant> = {
  draft: "muted",
  sent: "info",
  addressed: "success",
  resolved: "success",
};

const NO_MEMBERS: never[] = [];

function sourceLabel(annotation: PdfAnnotation): string | null {
  const source = annotation.source;
  return source ? `${source.path}:${lineSpan(source)}` : null;
}

export function PdfAnnotationsPanel({
  id,
  open,
  placingId,
  onClose,
  onShow,
  onPlaceAgain,
}: Readonly<{
  id: string;
  open: boolean;
  placingId: string | null;
  onClose: () => void;
  onShow: (annotation: PdfAnnotation) => void;
  onPlaceAgain: (annotation: PdfAnnotation | null) => void;
}>) {
  const { t } = useTranslation(["annotations"]);
  const quoteLabels = useAnnotationQuoteLabels();
  const items = usePdfAnnotationsStore((state) => state.items);
  const activeId = usePdfAnnotationsStore((state) => state.activeId);
  const error = usePdfAnnotationsStore((state) => state.error);
  const loaded = usePdfAnnotationsStore((state) => state.loaded);
  const readOnly = usePdfAnnotationsStore((state) => state.readOnly);
  const setAside = usePdfAnnotationsStore((state) => state.setAside);
  const [picked, setPicked] = useState<Readonly<Record<string, boolean>>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const activeRef = useRef<HTMLLIElement>(null);
  const isPicked = (item: PdfAnnotation) => picked[item.id] ?? item.status === "draft";
  const store = () => usePdfAnnotationsStore.getState();

  useEffect(() => {
    const item = activeRef.current;
    const body = item?.closest<HTMLElement>("[data-side-panel-body]");
    if (!open || !activeId || !item || !body) return;
    const shown = body.getBoundingClientRect();
    const box = item.getBoundingClientRect();
    if (box.top < shown.top) body.scrollTop -= shown.top - box.top;
    else if (box.bottom > shown.bottom) body.scrollTop += box.bottom - shown.bottom;
  }, [open, activeId]);

  const clearAll = async () => {
    const confirmed = await confirmAction({
      message: t(($) => $.annotations.panel.clearConfirm),
      confirmLabel: t(($) => $.annotations.panel.clear),
      destructive: true,
    });
    if (confirmed) await store().remove(items.map((item) => item.id));
  };

  return (
    <FloatingSidePanel
      id={id}
      open={open}
      side="right"
      width="20rem"
      title={t(($) => $.annotations.panel.title)}
      icon={<MessageSquareText />}
      closeLabel={t(($) => $.annotations.panel.close)}
      onClose={onClose}
      bodyClassName="px-2 pb-2 pt-0"
      footer={
        items.length > 0 ? (
          <>
            <Button variant="ghost" size="xs" onClick={() => void clearAll()}>
              {t(($) => $.annotations.panel.clear)}
            </Button>

          </>
        ) : null
      }
    >
      {error ? (
        <div className="mb-2">
          <InlineAlert>{t(($) => $.annotations.panel.failed, { error })}</InlineAlert>
        </div>
      ) : null}
      {readOnly ? (
        <div className="mb-2">
          <InlineAlert>{t(($) => $.annotations.panel.readOnly)}</InlineAlert>
        </div>
      ) : null}
      {setAside ? (
        <div className="mb-2">
          <InlineAlert>{t(($) => $.annotations.panel.setAside)}</InlineAlert>
        </div>
      ) : null}
      {!loaded && !error ? (
        <div className="flex justify-center py-4">
          <Spinner size="sm" />
        </div>
      ) : items.length === 0 ? (
        <p className="px-2 py-3 text-xs text-muted-foreground">{t(($) => $.annotations.panel.empty)}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => {
            const location = sourceLabel(item);
            const resolved = item.status === "resolved";
            const placing = placingId === item.id;
            return (
              <li
                key={item.id}
                ref={item.id === activeId ? activeRef : undefined}
                data-annotation-id={item.id}
                className={cn(
                  "space-y-1.5 rounded-md border border-transparent p-2 text-xs",
                  item.id === activeId ? "border-primary/40 bg-primary/10" : "hover:bg-accent/60",
                )}
              >
                <div className="flex items-start gap-2">
                  <Checkbox
                    className="mt-0.5"
                    checked={isPicked(item)}
                    onCheckedChange={(checked) => setPicked((current) => ({ ...current, [item.id]: checked === true }))}
                    aria-label={t(($) => $.annotations.panel.include, { number: item.number })}
                  />
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded text-left focus-visible:bg-accent"
                    onClick={() => onShow(item)}
                  >
                    <span className="flex w-full flex-wrap items-center gap-1.5">
                      <Badge size="sm">{item.number}</Badge>
                      <span className="font-medium">{t(($) => $.annotations.kind[item.kind])}</span>
                      <Badge size="sm" variant={STATUS_VARIANT[item.status]}>
                        {t(($) => $.annotations.status[item.status])}
                      </Badge>
                      {item.placement === "needsPlacing" ? (
                        <Badge size="sm" variant="outline">
                          {t(($) => $.annotations.status.needsPlacing)}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="flex w-full gap-1.5 text-muted-foreground">
                      <span className="min-w-0 flex-1 break-all">
                        {location ?? t(($) => $.annotations.panel.noSource)}
                      </span>
                      <span className="shrink-0">{t(($) => $.annotations.panel.page, { page: item.page })}</span>
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 shrink-0"
                    onClick={() => void store().update([{ id: item.id, status: resolved ? "draft" : "resolved" }])}
                    aria-label={
                      resolved
                        ? t(($) => $.annotations.panel.reopen, { number: item.number })
                        : t(($) => $.annotations.panel.resolve, { number: item.number })
                    }
                  >
                    {resolved ? <RotateCcw className="size-3.5" /> : <CheckCheck className="size-3.5" />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 shrink-0"
                    onClick={() => void store().remove([item.id])}
                    aria-label={t(($) => $.annotations.panel.delete, { number: item.number })}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <div className="space-y-1.5 pl-6">
                  {item.quote.text ? <CommentQuote quote={item.quote.text} labels={quoteLabels} /> : null}
                  {editingId === item.id ? (
                    <AnnotationCommentKit>
                      <CommentComposer
                        label={t(($) => $.annotations.panel.editComment, { number: item.number })}
                        submitLabel={t(($) => $.annotations.composer.save)}
                        initial={item.comment}
                        autoFocus
                        compact
                        onSubmit={async (comment) => {
                          if (!(await store().update([{ id: item.id, comment }]))) {
                            throw new Error(store().error ?? "");
                          }
                          setEditingId(null);
                        }}
                        onCancel={() => setEditingId(null)}
                      />
                    </AnnotationCommentKit>
                  ) : (
                    <Tooltip label={t(($) => $.annotations.panel.editComment, { number: item.number })}>
                      <button
                        type="button"
                        className={cn(
                          "w-full min-w-0 rounded px-1 py-0.5 text-left hover:bg-accent focus-visible:bg-accent",
                          !item.comment && "text-muted-foreground italic",
                        )}
                        onClick={() => setEditingId(item.id)}
                      >
                        {item.comment ? (
                          <CommentBody body={item.comment} members={NO_MEMBERS} className="mt-0 text-xs" />
                        ) : (
                          t(($) => $.annotations.panel.addComment)
                        )}
                      </button>
                    </Tooltip>
                  )}
                  {item.placement === "needsPlacing" ? (
                    <div className="space-y-1">
                      <p className="text-muted-foreground">
                        {placing
                          ? t(($) => $.annotations.panel.placing)
                          : t(($) => $.annotations.panel.notFound)}
                      </p>
                      <Button
                        variant="outline"
                        size="xs"
                        className="gap-1"
                        onClick={() => onPlaceAgain(placing ? null : item)}
                      >
                        <Crosshair className="size-3" />
                        {placing
                          ? t(($) => $.annotations.composer.cancel)
                          : t(($) => $.annotations.panel.placeAgain)}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </FloatingSidePanel>
  );
}
