import { useId } from "react";
import { Button } from "@/components/ui/button";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";

interface ConfirmationDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
}

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  destructive = false,
}: ConfirmationDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const { dialogRef, onBackdropMouseDown } = useModalAccessibility<HTMLDivElement>(
    open,
    onCancel,
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4">
      <button
        type="button"
        aria-label="Cancel"
        className="absolute inset-0"
        onMouseDown={onBackdropMouseDown}
      />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="relative w-full max-w-sm rounded-xl border bg-background p-5 shadow-2xl"
      >
        <h2 id={titleId} className="text-sm font-semibold">
          {title}
        </h2>
        <p
          id={descriptionId}
          className="mt-2 text-xs leading-relaxed text-muted-foreground"
        >
          {description}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} data-modal-initial-focus>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            size="sm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
