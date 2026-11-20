import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ModalShell } from "@/components/ui/modal-shell";

export function VersionPickDialog({
  title,
  description,
  detail,
  alert,
  actions,
  onClose,
  children,
}: Readonly<{
  title: ReactNode;
  description: ReactNode;
  detail?: ReactNode;
  alert?: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}>) {
  const { t } = useTranslation(["common"]);
  const titleId = useId();
  const descriptionId = useId();
  return (
    <ModalShell
      open
      portal
      onClose={onClose}
      closeLabel={t(($) => $.common.actions.close)}
      width="2xl"
      labelledBy={titleId}
      describedBy={descriptionId}
      className="flex max-h-[85vh] flex-col gap-3 p-5"
    >
      <h2 id={titleId} className="text-sm font-semibold">
        {title}
      </h2>
      <p id={descriptionId} className="text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
      {detail}
      <div className="h-80 min-h-0 overflow-hidden rounded-md border">{children}</div>
      {alert}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose} data-modal-initial-focus>
          {t(($) => $.common.actions.close)}
        </Button>
        {actions}
      </div>
    </ModalShell>
  );
}
