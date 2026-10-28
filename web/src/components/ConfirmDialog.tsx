import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ModalShell } from "@/components/ui/modal-shell";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: Readonly<{
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}>) {
  const { t } = useTranslation(["web"]);
  const titleId = useId();
  const descriptionId = useId();
  if (!open) return null;
  return (
    <ModalShell
      open
      onClose={onCancel}
      closeLabel={t(($) => $.web.app.cancel)}
      layer="nested"
      width="sm"
      role="alertdialog"
      labelledBy={titleId}
      describedBy={descriptionId}
      className="p-5"
      portal
    >
      <h2 id={titleId} className="text-sm font-semibold">
        {title}
      </h2>
      <p id={descriptionId} className="mt-2 select-text text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} data-modal-initial-focus>
          {t(($) => $.web.app.cancel)}
        </Button>
        <Button type="button" variant="destructive" size="sm" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </ModalShell>
  );
}
