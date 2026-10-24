import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ModalShell } from "@/components/ui/modal-shell";

/** A full-size view of an attached image. Loaded lazily. */
export default function AttachmentPreviewDialog({
  open,
  name,
  url,
  onClose,
}: Readonly<{ open: boolean; name: string; url: string; onClose: () => void }>) {
  const { t } = useTranslation(["common", "ai"]);
  if (!open) return null;
  return (
    <ModalShell
      open
      onClose={onClose}
      closeLabel={t(($) => $.common.actions.close)}
      layer="nested"
      width="2xl"
      portal
      animated
      label={name}
      testId="attachment-preview"
      className="flex max-h-[85vh] flex-col overflow-hidden"
    >
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-modal-initial-focus
          onClick={onClose}
          aria-label={t(($) => $.common.actions.close)}
          className="size-7 text-muted-foreground"
        >
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-muted/30 p-4">
        <img src={url} alt={name} className="mx-auto max-h-[70vh] max-w-full object-contain" />
      </div>
    </ModalShell>
  );
}
