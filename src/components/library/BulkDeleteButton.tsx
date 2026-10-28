import { type ReactNode, useLayoutEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { HOME_CHROME_SURFACE } from "@/components/library/home-chrome";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { isFolderProject } from "@/lib/library-projects";
import { logError } from "@/lib/log";
import { shortProjectName } from "@/lib/project-format";
import { type ProjectInfo, recycleProject, removeLinkedProject } from "@/lib/tauri";
import { notifyError, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useFilesStore } from "@/store/files";
import { useLibrarySelectionStore } from "@/store/library-selection";

const OPEN_LAYER = '[role="dialog"][data-state="open"], [role="alertdialog"], [role="menu"]';
const NAME_CLASS = "[overflow-wrap:anywhere]";

function typingInto(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select") !== null);
}

async function removeProject(project: ProjectInfo): Promise<void> {
  if (isFolderProject(project)) await removeLinkedProject(project.id);
  else await recycleProject(project.id);
}

export function BulkDeleteButton({
  projects,
  className,
}: Readonly<{ projects: readonly ProjectInfo[]; className?: string }>) {
  const { t } = useTranslation(["library"]);
  const ids = useLibrarySelectionStore((state) => state.ids);
  const refreshProjects = useFilesStore((state) => state.refreshProjects);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const selected = useMemo(
    () => projects.filter((project) => ids.has(project.id) && !project.recovery_pending),
    [projects, ids],
  );
  const hasSelection = ids.size > 0;

  useLayoutEffect(() => {
    if (!hasSelection) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || typingInto(event.target)) return;
      if (document.querySelector(OPEN_LAYER)) return;
      useLibrarySelectionStore.getState().clear();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasSelection]);

  if (selected.length === 0 && !confirming && !busy) return null;

  const count = selected.length;
  const only = count === 1 ? selected[0] : null;
  const folders = selected.some(isFolderProject);
  const label = t(($) => $.library.projects.bulkDelete.button, { count });

  const confirm = async () => {
    const targets = selected;
    setConfirming(false);
    setBusy(true);
    const results = await Promise.allSettled(targets.map(removeProject));
    const failed: ProjectInfo[] = [];
    let lastError: unknown = null;
    results.forEach((result, index) => {
      if (result.status === "fulfilled") return;
      failed.push(targets[index]);
      lastError = result.reason;
      void logError("bulk delete project", result.reason);
    });
    try {
      await refreshProjects();
    } catch (error) {
      void logError("refresh projects after bulk delete", error);
    }
    useLibrarySelectionStore.getState().replace(new Set(failed.map((project) => project.id)));
    setBusy(false);
    if (failed.length > 0) {
      notifyError(
        "bulk delete projects",
        lastError,
        t(($) => $.library.projects.bulkDelete.failed, { count: failed.length }),
      );
      return;
    }
    toast.success(t(($) => $.library.projects.bulkDelete.done, { count: targets.length }));
  };

  let title: ReactNode = t(($) => $.library.projects.bulkDelete.title, { count });
  let description = t(($) => $.library.projects.bulkDelete.description);
  let confirmLabel = t(($) => $.library.projects.deleteDialog.confirm);
  if (only && isFolderProject(only)) {
    title = (
      <Trans
        ns="library"
        i18nKey={($) => $.library.folder.remove.title}
        values={{ name: shortProjectName(only.name) }}
        components={{ name: <span title={only.name} className={NAME_CLASS} /> }}
      />
    );
    description = t(($) => $.library.folder.remove.description);
    confirmLabel = t(($) => $.library.folder.remove.confirm);
  } else if (only) {
    title = (
      <Trans
        ns="library"
        i18nKey={($) => $.library.projects.deleteDialog.title}
        values={{ name: shortProjectName(only.name) }}
        components={{ name: <span title={only.name} className={NAME_CLASS} /> }}
      />
    );
    description = t(($) => $.library.projects.deleteDialog.description);
  } else if (folders) {
    description = `${description} ${t(($) => $.library.projects.bulkDelete.folderNote)}`;
  }

  return (
    <>
      <Tooltip label={label} className={className}>
        <Button
          data-testid="bulk-delete-button"
          variant="ghost"
          size="icon"
          disabled={busy || count === 0}
          aria-label={label}
          className={cn(
            HOME_CHROME_SURFACE,
            "size-10 rounded-2xl p-0 text-muted-foreground hover:text-destructive focus-visible:bg-accent focus-visible:text-destructive dark:focus-visible:bg-accent/60",
          )}
          onClick={() => setConfirming(true)}
        >
          {busy ? <Spinner /> : <Trash2 aria-hidden="true" className="size-4" />}
        </Button>
      </Tooltip>
      <ConfirmationDialog
        open={confirming && count > 0}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => void confirm()}
      />
    </>
  );
}
