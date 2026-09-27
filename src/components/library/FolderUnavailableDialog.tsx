import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { asUnavailable, type UnavailableFolder } from "@/components/library/folder-state";
import { folderDisplayPath, folderUnavailable } from "@/lib/library-projects";
import { adoptReplacedFolder, locateProjectFolder, type ProjectInfo } from "@/lib/tauri";
import { notifyError } from "@/lib/toast";
import { cn, isMac } from "@/lib/utils";
import { useLibraryAvailabilityStore } from "@/store/library-availability";

type Busy = "locate" | "check" | "adopt" | null;

type Translate = ReturnType<typeof useTranslation<["common", "library"]>>["t"];

type FolderCopyValues = { name: string; path: string };

type FolderCopy = { title: string; body: ReactNode };

const PATH_BADGE = {
  components: {
    path: (
      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground break-all box-decoration-clone" />
    ),
  },
  tOptions: { interpolation: { escapeValue: true } },
  shouldUnescape: true,
};

function folderProblemCopy(
  t: Translate,
  state: UnavailableFolder,
  values: FolderCopyValues,
): FolderCopy {
  switch (state) {
    case "missing":
      return {
        title: t(($) => $.library.folder.unavailable.missing.title, values),
        body: (
          <Trans
            ns="library"
            i18nKey={($) => $.library.folder.unavailable.missing.body}
            values={values}
            {...PATH_BADGE}
          />
        ),
      };
    case "offline":
      return {
        title: t(($) => $.library.folder.unavailable.offline.title, values),
        body: (
          <Trans
            ns="library"
            i18nKey={($) => $.library.folder.unavailable.offline.body}
            values={values}
            {...PATH_BADGE}
          />
        ),
      };
    case "replaced":
      return {
        title: t(($) => $.library.folder.unavailable.replaced.title, values),
        body: (
          <Trans
            ns="library"
            i18nKey={($) => $.library.folder.unavailable.replaced.body}
            values={values}
            {...PATH_BADGE}
          />
        ),
      };
    case "permission_denied":
      return {
        title: t(($) => $.library.folder.unavailable.permissionDenied.title, values),
        body: isMac ? (
          t(($) => $.library.folder.unavailable.permissionDenied.bodyMac)
        ) : (
          <Trans
            ns="library"
            i18nKey={($) => $.library.folder.unavailable.permissionDenied.bodyOther}
            values={values}
            {...PATH_BADGE}
          />
        ),
      };
  }
}

function folderDialogCopy(
  t: Translate,
  state: UnavailableFolder,
  reachable: boolean,
  values: FolderCopyValues,
): FolderCopy {
  if (!reachable) return folderProblemCopy(t, state, values);
  return {
    title: t(($) => $.library.folder.unavailable.back.title, values),
    body: (
      <Trans
        ns="library"
        i18nKey={($) => $.library.folder.unavailable.back.body}
        values={values}
        {...PATH_BADGE}
      />
    ),
  };
}

function TryAgainButton({
  primaryRef,
  busy,
  onClick,
}: Readonly<{
  primaryRef: RefObject<HTMLButtonElement | null>;
  busy: Busy;
  onClick: () => void;
}>) {
  const { t } = useTranslation(["common", "library"]);
  const checking = busy === "check";
  return (
    <Button ref={primaryRef} size="sm" disabled={busy !== null} onClick={onClick}>
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
}

function FolderProblemActions({
  state,
  primaryRef,
  busy,
  onLocate,
  onTryAgain,
  onAdopt,
}: Readonly<{
  state: UnavailableFolder;
  primaryRef: RefObject<HTMLButtonElement | null>;
  busy: Busy;
  onLocate: () => void;
  onTryAgain: () => void;
  onAdopt: () => void;
}>) {
  const { t } = useTranslation(["common", "library"]);
  const locateButton = (primary: boolean) => (
    <Button
      ref={primary ? primaryRef : undefined}
      size="sm"
      variant={primary ? "default" : "outline"}
      disabled={busy !== null}
      onClick={onLocate}
    >
      {t(($) => $.library.folder.unavailable.locate)}
    </Button>
  );
  const tryAgainButton = (
    <TryAgainButton primaryRef={primaryRef} busy={busy} onClick={onTryAgain} />
  );
  switch (state) {
    case "missing":
      return locateButton(true);
    case "offline":
      return (
        <>
          {locateButton(false)}
          {tryAgainButton}
        </>
      );
    case "replaced":
      return (
        <>
          {locateButton(false)}
          <Button ref={primaryRef} size="sm" disabled={busy !== null} onClick={onAdopt}>
            {t(($) => $.library.folder.unavailable.useThisFolder)}
          </Button>
        </>
      );
    case "permission_denied":
      return tryAgainButton;
  }
}

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
  const values = { name: project.name, path: folderDisplayPath(project) ?? "" };
  const copy = folderDialogCopy(t, state, reachable, values);

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

  const actions = reachable ? (
    <Button ref={primaryRef} size="sm" onClick={() => onOpen(project.id)}>
      {t(($) => $.common.actions.open)}
    </Button>
  ) : (
    <FolderProblemActions
      key={state}
      state={state}
      primaryRef={primaryRef}
      busy={busy}
      onLocate={locate}
      onTryAgain={tryAgain}
      onAdopt={adopt}
    />
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
        <DialogHeader className="min-w-0 pr-6">
          <DialogTitle className="text-base leading-snug [overflow-wrap:anywhere]">
            {copy.title}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed [overflow-wrap:anywhere]">
            {copy.body}
          </DialogDescription>
        </DialogHeader>
        <p
          role="status"
          aria-live="polite"
          className="min-h-4 text-xs text-amber-700 dark:text-amber-400"
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
