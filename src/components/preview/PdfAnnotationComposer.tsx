import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Crosshair, Eraser, MessageSquarePlus, MessagesSquare, Replace, TextCursorInput } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnchoredPopover, type PopoverAnchor } from "@/components/ui/popover";
import { CommentComposer } from "@/components/ui/comments/comment-composer";
import type { PdfAnnotationKind } from "@/lib/tauri";
import { AnnotationCommentKit } from "./annotation-comment-kit";

export type TextAnnotationKind = Exclude<PdfAnnotationKind, "region">;

const ACTIONS: readonly { kind: TextAnnotationKind; icon: typeof Eraser }[] = [
  { kind: "comment", icon: MessageSquarePlus },
  { kind: "delete", icon: Eraser },
  { kind: "replace", icon: Replace },
  { kind: "insert", icon: TextCursorInput },
];

export function PdfAnnotationComposer({
  anchor,
  contextElement,
  annotate,
  kind,
  placing,
  commenting = false,
  onComment,
  onPick,
  onSave,
  onPlace,
  onCancel,
}: Readonly<{
  anchor: PopoverAnchor;
  contextElement: Element | null;
  annotate: boolean;
  kind: Exclude<PdfAnnotationKind, "delete"> | null;
  placing: boolean;
  commenting?: boolean;
  onComment?: () => void;
  onPick: (kind: TextAnnotationKind) => void;
  onSave: (comment: string) => Promise<void>;
  onPlace: () => void;
  onCancel: () => void;
}>) {
  const { t } = useTranslation(["annotations"]);
  const typed = useRef(false);
  const keep = (event: Event) => {
    if (typed.current) event.preventDefault();
  };
  return (
    <AnchoredPopover
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      onEscapeKeyDown={(event) => {
        if (event.isComposing || typed.current) event.preventDefault();
      }}
      onInteractOutside={keep}
      anchor={anchor}
      contextElement={contextElement}
      side="bottom"
      align="start"
      sideOffset={6}
      ariaLabel={t(($) => $.annotations.composer.title)}
      bare={kind !== null}
      className={kind ? "w-72" : "w-auto p-1"}
      onOpenAutoFocus={(event) => {
        if (!kind) event.preventDefault();
      }}
      onCloseAutoFocus={(event) => event.preventDefault()}
    >
      {kind ? (
        <AnnotationCommentKit>
          <CommentComposer
            label={t(($) => $.annotations.composer.label[kind])}
            placeholder={t(($) => $.annotations.composer.placeholder[kind])}
            submitLabel={t(($) => $.annotations.composer.save)}
            autoFocus
            onActivity={(active) => {
              typed.current = active;
            }}
            onSubmit={onSave}
            onCancel={onCancel}
          />
        </AnnotationCommentKit>
      ) : placing ? (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="gap-1"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onPlace}
        >
          <Crosshair className="size-3.5" />
          {t(($) => $.annotations.composer.placeHere)}
        </Button>
      ) : (
        <div className="flex items-center gap-0.5">
          {onComment ? (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="gap-1"
              disabled={commenting}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onComment}
            >
              <MessagesSquare className="size-3.5" />
              {t(($) => $.annotations.composer.coauthors)}
            </Button>
          ) : null}
          {annotate
            ? ACTIONS.map(({ kind: action, icon: Icon }) => (
                <Button
                  key={action}
                  type="button"
                  size="xs"
                  variant="ghost"
                  className="gap-1"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onPick(action)}
                >
                  <Icon className="size-3.5" />
                  {t(($) => $.annotations.composer.action[action])}
                </Button>
              ))
            : null}
        </div>
      )}
    </AnchoredPopover>
  );
}
