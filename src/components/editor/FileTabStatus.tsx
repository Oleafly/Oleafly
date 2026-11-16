import { useTranslation } from "react-i18next";
import { FileWarning } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { useNotOnOverleafYet } from "@/lib/collab-live-bridge";
import { useFilesStore } from "@/store/files";

export function FileTabStatus({ path }: Readonly<{ path: string }>) {
  const { t } = useTranslation(["editor"]);
  const dirty = useFilesStore((s) => s.files[path]?.dirty ?? false);
  const changedOnDisk = useFilesStore((s) => s.changedOnDisk.includes(path));
  const projectId = useFilesStore((s) => s.projectId);
  const notOnOverleafYet = useNotOnOverleafYet(projectId, path);
  if (changedOnDisk) {
    const label = t(($) => $.editor.changedOnDisk.tabMark);
    return (
      <span title={label} className="inline-flex text-amber-700 dark:text-amber-400">
        <FileWarning aria-hidden="true" className="size-3" />
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  if (notOnOverleafYet) {
    const label = t(($) => $.editor.liveTab.notOnOverleafYet);
    return (
      <Tooltip label={label}>
        <span data-testid="tab-not-on-overleaf" className="inline-flex">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-muted-foreground/70" />
          <span className="sr-only">{label}</span>
        </span>
      </Tooltip>
    );
  }
  if (!dirty) return null;
  return <span className="size-1.5 rounded-full bg-primary" />;
}
