import { useTranslation } from "react-i18next";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { DetailList } from "@/components/ui/detail-list";
import { useOverleafImportStore } from "@/store/overleaf-import";

export function OverleafSignOutQuestion() {
  const { t } = useTranslation("settings");
  const unsent = useOverleafImportStore((state) => state.unsent);
  const signOut = useOverleafImportStore((state) => state.signOut);
  const staySignedIn = useOverleafImportStore((state) => state.staySignedIn);
  const items = (unsent ?? []).map((project) => ({
    key: project.project_id,
    title: project.name,
    detail: t(($) => $.settings.integrations.overleaf.unsent.files, { files: (project.paths ?? []).join(", ") }),
  }));
  return (
    <ConfirmationDialog
      open={unsent !== null}
      title={t(($) => $.settings.integrations.overleaf.unsent.title)}
      description={t(($) => $.settings.integrations.overleaf.unsent.description)}
      confirmLabel={t(($) => $.settings.integrations.overleaf.unsent.signOut)}
      cancelLabel={t(($) => $.settings.integrations.overleaf.unsent.stay)}
      onConfirm={() => void signOut(true)}
      onCancel={staySignedIn}
    >
      <DetailList items={items} testId="overleaf-unsent-projects" />
    </ConfirmationDialog>
  );
}
