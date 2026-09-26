import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderX } from "lucide-react";
import { recheckProjectAvailability } from "./ProjectAvailabilityKeeper";
import { adoptReplacedFolder, locateProjectFolder, revealInDir, saveOpenBuffersCopy } from "@/lib/tauri";
import { notifyError, toast } from "@/lib/toast";
import { collectOpenBuffersForCopy, useFilesStore } from "@/store/files";
import { folderReachable, useProjectAvailabilityStore } from "@/store/project-availability";

const BUTTON =
  "rounded border border-transparent px-2 py-0.5 font-medium transition-colors hover:bg-amber-500/15 focus-visible:border-amber-500/40 focus-visible:bg-amber-500/20 disabled:opacity-50";

export function FolderUnavailableBanner() {
  const { t } = useTranslation(["shell", "core"]);
  const projectId = useProjectAvailabilityStore((state) => state.projectId);
  const availability = useProjectAvailabilityStore((state) => state.availability);
  const projectName = useFilesStore((state) => state.projectName);
  const hasOpenFiles = useFilesStore((state) => Object.keys(state.files).length > 0);
  const [busy, setBusy] = useState(false);
  if (!projectId || folderReachable(availability)) return null;

  const run = (scope: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    void action()
      .catch((error) => notifyError(scope, error))
      .finally(() => setBusy(false));
  };
  const saveCopy = async () => {
    const saved = await saveOpenBuffersCopy(
      projectId,
      projectName,
      collectOpenBuffersForCopy(projectId),
    );
    if (!saved) return;
    toast.success(t(($) => $.shell.folderUnavailable.savedCopy, { folder: saved.folder }), {
      label: t(($) => $.core.export.showInFolder),
      onClick: () => {
        void revealInDir(saved.folder).catch((error) =>
          notifyError("show saved copy", error, t(($) => $.core.export.revealFailed)),
        );
      },
    });
  };

  let title = t(($) => $.shell.folderUnavailable.missing.title);
  let body = t(($) => $.shell.folderUnavailable.missing.body);
  if (availability === "replaced") {
    title = t(($) => $.shell.folderUnavailable.replaced.title);
    body = t(($) => $.shell.folderUnavailable.replaced.body);
  } else if (availability === "permission_denied") {
    title = t(($) => $.shell.folderUnavailable.permissionDenied.title);
    body = t(($) => $.shell.folderUnavailable.permissionDenied.body);
  }

  return (
    <div
      data-testid="folder-unavailable-banner"
      className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400"
    >
      <FolderX aria-hidden="true" className="size-3.5 shrink-0" />
      <output className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">{title}</span>
        <span className="min-w-0 flex-1">{body}</span>
      </output>
      <span className="flex shrink-0 items-center gap-1">
        {availability === "replaced" && (
          <button
            type="button"
            className={BUTTON}
            disabled={busy}
            onClick={() =>
              run("use the replaced folder", async () => {
                await adoptReplacedFolder(projectId);
              })
            }
          >
            {t(($) => $.shell.folderUnavailable.useThisFolder)}
          </button>
        )}
        {availability !== "permission_denied" && (
          <button
            type="button"
            className={BUTTON}
            disabled={busy}
            onClick={() =>
              run("locate project folder", async () => {
                await locateProjectFolder(projectId);
              })
            }
          >
            {t(($) => $.shell.folderUnavailable.locate)}
          </button>
        )}
        <button
          type="button"
          className={BUTTON}
          disabled={busy || !hasOpenFiles}
          onClick={() => run("save a copy of open files", saveCopy)}
        >
          {t(($) => $.shell.folderUnavailable.saveCopy)}
        </button>
        {availability !== "replaced" && (
          <button
            type="button"
            className={BUTTON}
            disabled={busy}
            onClick={() => run("check project folder", recheckProjectAvailability)}
          >
            {t(($) => $.shell.folderUnavailable.tryAgain)}
          </button>
        )}
      </span>
    </div>
  );
}
