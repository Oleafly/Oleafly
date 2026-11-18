import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { formatList } from "@/lib/intl";
import { basename } from "@/lib/path-utils";
import { useFilesStore } from "@/store/files";
import { useOverleafTree } from "./overleaf-tree";

const NONE: readonly string[] = [];

export function OverleafDeleteDialog() {
  const { t } = useTranslation(["collab"]);
  const projectId = useFilesStore((state) => state.projectId);
  const { asking, deciding } = useOverleafTree(
    useShallow((state) => ({
      asking: projectId !== null && state.projectId === projectId ? state.asking : NONE,
      deciding: state.deciding,
    })),
  );
  if (asking.length === 0) return null;
  const decide = (onOverleaf: boolean) => void useOverleafTree.getState().decide(onOverleaf);
  return (
    <ConfirmationDialog
      open={!deciding}
      title={t(($) => $.collab.overleafTree.deleteTitle)}
      description={t(($) => $.collab.overleafTree.deleteDescription, { files: formatList(asking.map(basename)) })}
      confirmLabel={t(($) => $.collab.overleafTree.deleteConfirm)}
      cancelLabel={t(($) => $.collab.overleafTree.keep)}
      destructive
      onConfirm={() => decide(true)}
      onCancel={() => decide(false)}
    />
  );
}
