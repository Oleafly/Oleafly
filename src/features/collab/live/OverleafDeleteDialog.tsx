import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { InlineAlert } from "@/components/ui/inline-alert";
import { formatList } from "@/lib/intl";
import { basename } from "@/lib/path-utils";
import { useFilesStore } from "@/store/files";
import { useOverleafTree } from "./overleaf-tree";

const NONE: readonly string[] = [];

export function OverleafDeleteDialog() {
  const { t } = useTranslation(["collab"]);
  const projectId = useFilesStore((state) => state.projectId);
  const { asking, deciding, failed } = useOverleafTree(
    useShallow((state) => ({
      asking: projectId !== null && state.projectId === projectId ? state.asking : NONE,
      deciding: state.deciding,
      failed: state.failed,
    })),
  );
  if (asking.length === 0) return null;
  const decide = (onOverleaf: boolean) => void useOverleafTree.getState().decide(onOverleaf);
  const files = formatList(asking.map(basename));
  return (
    <ConfirmationDialog
      open={!deciding}
      title={t(($) => $.collab.overleafTree.deleteTitle)}
      description={t(($) => $.collab.overleafTree.deleteDescription, { files })}
      confirmLabel={t(($) => $.collab.overleafTree.deleteConfirm)}
      cancelLabel={t(($) => $.collab.overleafTree.keep)}
      destructive
      onConfirm={() => decide(true)}
      onCancel={() => decide(false)}
    >
      {failed ? (
        <InlineAlert className="mt-3">{t(($) => $.collab.overleafBanners.stoppedActionFailed, { file: files })}</InlineAlert>
      ) : null}
    </ConfirmationDialog>
  );
}
