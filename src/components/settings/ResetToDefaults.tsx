import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";

interface ResetToDefaultsProps {
  sectionName: string;
  onReset: () => void;
  disabled?: boolean;
  confirmationDescription?: string;
}

export function ResetToDefaults({
  sectionName,
  onReset,
  disabled = false,
  confirmationDescription,
}: ResetToDefaultsProps) {
  const { t } = useTranslation(["common", "settings"]);
  const [confirmationOpen, setConfirmationOpen] = useState(false);

  const description = t(($) => $.settings.reset.description, { sectionName });

  return (
    <>
      <div className="mt-2 flex items-center justify-between gap-3 border-t pt-4">
        <div>
          <p className="text-sm">{t(($) => $.settings.reset.label)}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          disabled={disabled}
          onClick={() => setConfirmationOpen(true)}
        >
          <RotateCcw className="size-3.5" />
          {t(($) => $.settings.reset.button)}
        </Button>
      </div>
      <ConfirmationDialog
        open={confirmationOpen}
        title={t(($) => $.settings.reset.confirmTitle, { sectionName })}
        description={
          confirmationDescription ??
          t(($) => $.settings.reset.confirmDescription, { sectionName })
        }
        confirmLabel={t(($) => $.settings.reset.button)}
        cancelLabel={t(($) => $.common.actions.cancel)}
        destructive
        onCancel={() => setConfirmationOpen(false)}
        onConfirm={() => {
          onReset();
          setConfirmationOpen(false);
        }}
      />
    </>
  );
}
