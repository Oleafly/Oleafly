import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FOLDER_STATE_ICON,
  asUnavailable,
  type UnavailableFolder,
} from "@/components/library/folder-state";
import { folderDisplayPath, folderUnavailable } from "@/lib/library-projects";
import { adoptReplacedFolder, locateProjectFolder, type ProjectInfo } from "@/lib/tauri";
import { notifyError } from "@/lib/toast";
import { cn, isMac } from "@/lib/utils";
import { useLibraryAvailabilityStore } from "@/store/library-availability";

type Busy = "locate" | "check" | "adopt" | null;

export function FolderUnavailableDialog({
  project,
  availability,
  reachable = false,
  onClose,
  onOpen,
  onRemove,
}: Readonly<{
  project: ProjectInfo | null;
  availability: UnavailableFolder;
  reachable?: boolean;
  onClose: () => void;
  onOpen: (projectId: string) => void;
  onRemove: (project: ProjectInfo) => void;
}>) {
  const { t } = useTranslation(["common", "library"]);
  const check = useLibraryAvailabilityStore((state) => state.check);
  const [busy, setBusy] = useState<Busy>(null);
  const [still, setStill] = useState(false);
  const [state, setState] = useState<UnavailableFolder>(availability);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const shown = useRef({ state, reachable });
  const refocus = useRef(false);

  useEffect(() => {
    if (shown.current.state !== state || shown.current.reachable !== reachable) {
      shown.current = { state, reachable };
      refocus.current = true;
    }
    if (!refocus.current || busy !== null || !primaryRef.current) return;
    refocus.current = false;
    const active = document.activeElement;
    if (!active || active === document.body || active.getAttribute("role") === "dialog") {
      primaryRef.current.focus();
    }
  }, [state, reachable, busy]);

  if (!project) return null;
  const Icon = reachable ? FolderCheck : FOLDER_STATE_ICON[state];
  const values = { name: project.name, path: folderDisplayPath(project) ?? "" };
  const problem = {
    missing: {
      title: t(($) => $.library.folder.unavailable.missing.title, values),
      body: t(($) => $.library.folder.unavailable.missing.body, values),
    },
    offline: {
      title: t(($) => $.library.folder.unavailable.offline.title, values),
      body: t(($) => $.library.folder.unavailable.offline.body, values),
    },
    replaced: {
      title: t(($) => $.library.folder.unavailable.replaced.title, values),
      body: t(($) => $.library.folder.unavailable.replaced.body, values),
    },
    permission_denied: {
      title: t(($) => $.library.folder.unavailable.permissionDenied.title, values),
      body: isMac
        ? t(($) => $.library.folder.unavailable.permissionDenied.bodyMac)
        : t(($) => $.library.folder.unavailable.permissionDenied.bodyOther, values),
    },
  }[state];
  const copy = reachable
    ? {
        title: t(($) => $.library.folder.unavailable.back.title, values),
        body: t(($) => $.library.folder.unavailable.back.body, values),
      }
    : problem;

  const run = (action: Exclude<Busy, null>, scope: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(action);
    setStill(false);
    void work()
      .catch((error: unknown) => notifyError(scope, error))
      .finally(() => setBusy(null));
  };
  const rebound = async (outcome: Promise<string>) => {
    if ((await outcome) !== "rebound") return;
    await check([project.id], { force: true });
    onOpen(project.id);
  };
  const locate = () =>
    run("locate", "locate project folder", () => rebound(locateProjectFolder(project.id)));
  const adopt = () =>
    run("adopt", "use the replaced folder", () => rebound(adoptReplacedFolder(project.id)));
  const tryAgain = () =>
    run("check", "check project folder", async () => {
      const found = await check([project.id], { force: true });
      const next = found[project.id];
      if (next && !folderUnavailable(next)) {
        onOpen(project.id);
        return;
      }
      const changed = next ? asUnavailable(next) : null;
      if (changed && changed !== state) setState(changed);
      else setStill(true);
    });

  const locateButton = (primary: boolean) => (
    <Button
      ref={primary ? primaryRef : undefined}
      size="sm"
      variant={primary ? "default" : "outline"}
      disabled={busy !== null}
      onClick={locate}
    >
      {t(($) => $.library.folder.unavailable.locate)}
    </Button>
  );
  const checking = busy === "check";
  const tryAgainButton = (
    <Button ref={primaryRef} size="sm" disabled={busy !== null} onClick={tryAgain}>
      <span className="grid">
        <span
          aria-hidden={checking}
          className={cn("col-start-1 row-start-1", checking && "invisible")}
        >
          {t(($) => $.library.folder.unavailable.tryAgain)}
        </span>
        <span
          aria-hidden={!checking}
          className={cn("col-start-1 row-start-1", !checking && "invisible")}
        >
          {t(($) => $.library.folder.unavailable.checking)}
        </span>
      </span>
    </Button>
  );
  const actions = reachable ? (
    <Button ref={primaryRef} size="sm" onClick={() => onOpen(project.id)}>
      {t(($) => $.common.actions.open)}
    </Button>
  ) : (
    <>
      {state === "missing" ? locateButton(true) : null}
      {state === "offline" ? (
        <>
          {locateButton(false)}
          {tryAgainButton}
        </>
      ) : null}
      {state === "replaced" ? (
        <>
          {locateButton(false)}
          <Button ref={primaryRef} size="sm" disabled={busy !== null} onClick={adopt}>
            {t(($) => $.library.folder.unavailable.useThisFolder)}
          </Button>
        </>
      ) : null}
      {state === "permission_denied" ? tryAgainButton : null}
    </>
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-w-md"
        onOpenAutoFocus={(event) => {
          if (!primaryRef.current) return;
          event.preventDefault();
          primaryRef.current.focus();
        }}
      >
        <DialogHeader className="pr-6">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg",
                reachable
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
              )}
            >
              <Icon className="size-4" />
            </span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <DialogTitle className="text-base leading-snug [overflow-wrap:anywhere]">
                {copy.title}
              </DialogTitle>
              <DialogDescription className="text-xs leading-relaxed [overflow-wrap:anywhere]">
                {copy.body}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <p
          role="status"
          aria-live="polite"
          className="min-h-4 pl-12 text-xs text-amber-700 dark:text-amber-400"
        >
          {still && !reachable ? t(($) => $.library.folder.unavailable.still) : null}
        </p>
        <DialogFooter className="sm:items-center">
          {reachable ? null : (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground sm:mr-auto"
              disabled={busy !== null}
              onClick={() => onRemove(project)}
            >
              {t(($) => $.library.folder.menu.remove)}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t(($) => $.common.actions.cancel)}
          </Button>
          {actions}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
