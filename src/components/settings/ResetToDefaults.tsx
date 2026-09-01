import { useState } from "react";
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
  const [confirmationOpen, setConfirmationOpen] = useState(false);

  const description = `Restore ${sectionName} preferences to their defaults.`;

  return (
    <>
      <div className="mt-2 flex items-center justify-between gap-3 border-t pt-4">
        <div>
          <p className="text-sm">Reset settings</p>
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
          Reset to defaults
        </Button>
      </div>
      <ConfirmationDialog
        open={confirmationOpen}
        title={`Reset ${sectionName} settings?`}
        description={
          confirmationDescription ??
          `${description} Other settings will stay unchanged.`
        }
        confirmLabel="Reset to defaults"
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
