import { type ReactNode, useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { ModalShell } from "@/components/ui/modal-shell";

interface ConfirmationDialogProps {
  open: boolean;
  title: ReactNode;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  destructive?: boolean;
  confirmOnEnter?: boolean;
  children?: ReactNode;
}

export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  destructive = false,
  confirmOnEnter = !destructive,
  children,
}: Readonly<ConfirmationDialogProps>) {
  const { t } = useTranslation(["common", "shell"]);
  const titleId = useId();
  const descriptionId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!open || !confirmOnEnter) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        target !== document.body &&
        target !== document.documentElement &&
        !titleRef.current?.closest('[role="alertdialog"]')?.contains(target)
      ) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      onConfirm();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, confirmOnEnter, onConfirm]);

  if (!open) return null;

  return (
    <ModalShell
      open
      onClose={onCancel}
      closeLabel={t(($) => $.common.actions.cancel)}
      layer="nested"
      width="sm"
      role="alertdialog"
      labelledBy={titleId}
      describedBy={descriptionId}
      className="p-5"
    >
      <h2 ref={titleRef} id={titleId} className="text-sm font-semibold">
        {title}
      </h2>
      <p
        id={descriptionId}
        className="mt-2 select-text text-xs leading-relaxed text-muted-foreground"
      >
        {description}
      </p>
      {children}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} data-modal-initial-focus>
          {cancelLabel ?? t(($) => $.common.actions.cancel)}
          <Kbd className="h-4 min-w-4 px-1 text-[0.625rem]">{t(($) => $.shell.keys.esc)}</Kbd>
        </Button>
        <Button
          variant={destructive ? "destructive" : "default"}
          size="sm"
          onClick={onConfirm}
        >
          {confirmLabel}
          {confirmOnEnter ? (
            <Kbd className="h-4 min-w-4 bg-background/25 px-1 text-[0.625rem] text-current">↵</Kbd>
          ) : null}
        </Button>
      </div>
    </ModalShell>
  );
}
