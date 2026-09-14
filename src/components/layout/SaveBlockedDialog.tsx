import { useTranslation } from "react-i18next";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { notifyError } from "@/lib/toast";
import { useFilesStore } from "@/store/files";

export function SaveBlockedDialog() {
  const { t } = useTranslation(["core"]);
  const blocked = useFilesStore((s) => s.saveBlocked);
  const dismissSaveBlocked = useFilesStore((s) => s.dismissSaveBlocked);
  const discardUnsavedAndLeave = useFilesStore((s) => s.discardUnsavedAndLeave);
  const failures = blocked?.failures ?? [];
  const first = failures[0];
  let description = "";
  if (first && failures.length === 1) {
    description = t(($) => $.core.project.saveBlockedOne, {
      file: first.path,
      reason: first.reason,
    });
  } else if (first) {
    description = t(($) => $.core.project.saveBlockedMany, {
      count: failures.length,
      files: failures.map((failure) => failure.path).join(", "),
      reason: first.reason,
    });
  }
  return (
    <ConfirmationDialog
      open={!!blocked}
      title={t(($) => $.core.project.saveBlockedTitle)}
      description={description}
      confirmLabel={t(($) => $.core.project.saveBlockedDiscard)}
      cancelLabel={t(($) => $.core.project.saveBlockedStay)}
      destructive
      onConfirm={() => {
        void discardUnsavedAndLeave().catch((error) =>
          notifyError("discard unsaved changes and leave", error),
        );
      }}
      onCancel={dismissSaveBlocked}
    />
  );
}
