import { useTranslation } from "react-i18next";
import { Crosshair, Eraser, MessageSquarePlus, Replace, TextCursorInput } from "lucide-react";
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
  kind,
  placing,
  onPick,
  onSave,
  onPlace,
  onCancel,
}: Readonly<{
  anchor: PopoverAnchor;
  contextElement: Element | null;
  kind: PdfAnnotationKind | null;
  placing: boolean;
  onPick: (kind: TextAnnotationKind) => void;
  onSave: (comment: string) => Promise<void>;
  onPlace: () => void;
  onCancel: () => void;
}>) {
  const { t } = useTranslation(["preview"]);
  return (
    <AnchoredPopover
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      anchor={anchor}
      contextElement={contextElement}
      side="bottom"
      align="start"
      sideOffset={6}
      ariaLabel={t(($) => $.preview.annotations.composer.title)}
      className={kind ? "w-72 p-2" : "w-auto p-1"}
      onOpenAutoFocus={(event) => {
        if (!kind) event.preventDefault();
      }}
      onCloseAutoFocus={(event) => event.preventDefault()}
    >
      {kind ? (
        <AnnotationCommentKit>
          <CommentComposer
            label={t(($) => $.preview.annotations.composer.label[kind])}
            placeholder={t(($) => $.preview.annotations.composer.placeholder[kind])}
            submitLabel={t(($) => $.preview.annotations.composer.save)}
            autoFocus
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
          {t(($) => $.preview.annotations.composer.placeHere)}
        </Button>
      ) : (
        <div className="flex items-center gap-0.5">
          {ACTIONS.map(({ kind: action, icon: Icon }) => (
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
              {t(($) => $.preview.annotations.composer.action[action])}
            </Button>
          ))}
        </div>
      )}
    </AnchoredPopover>
  );
}
