import { useTranslation } from "react-i18next";
import { FileWarning } from "lucide-react";
import { useFilesStore } from "@/store/files";

export function FileTabStatus({ path }: Readonly<{ path: string }>) {
  const { t } = useTranslation(["editor"]);
  const dirty = useFilesStore((s) => s.files[path]?.dirty ?? false);
  const changedOnDisk = useFilesStore((s) => s.changedOnDisk.includes(path));
  if (changedOnDisk) {
    const label = t(($) => $.editor.changedOnDisk.tabMark);
    return (
      <span title={label} className="inline-flex text-amber-700 dark:text-amber-400">
        <FileWarning aria-hidden="true" className="size-3" />
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  if (!dirty) return null;
  return <span className="size-1.5 rounded-full bg-primary" />;
}
