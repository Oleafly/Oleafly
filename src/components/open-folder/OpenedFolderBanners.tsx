import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Lock, ShieldAlert, X } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { decodeAppError } from "@/lib/app-error";
import { copyLinkedIntoLibrary } from "@/lib/tauri";
import { notifyError, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useFilesStore } from "@/store/files";
import { folderIsReadOnly, folderIsRestricted, useFolderAccessStore } from "@/store/folder-access";
import { folderReachable, useProjectAvailabilityStore } from "@/store/project-availability";

const TRUST_BUTTON =
  "flex items-center gap-1 rounded border border-transparent px-2 py-0.5 font-medium transition-colors hover:bg-primary/10 focus-visible:border-primary/40 focus-visible:bg-primary/15 disabled:opacity-50";
const READ_ONLY_BUTTON =
  "flex items-center gap-1 rounded border border-transparent px-2 py-0.5 font-medium transition-colors hover:bg-amber-500/15 focus-visible:border-amber-500/40 focus-visible:bg-amber-500/20 disabled:opacity-50";

function useFolderReachable(projectId: string | null): boolean {
  return useProjectAvailabilityStore(
    (state) => state.projectId !== projectId || folderReachable(state.availability),
  );
}

function TrustBanner({ projectId }: Readonly<{ projectId: string }>) {
  const { t } = useTranslation(["shell"]);
  const restricted = useFolderAccessStore((state) => folderIsRestricted(state, projectId));
  const hidden = useFolderAccessStore((state) => state.bannerHidden);
  const parent = useFolderAccessStore((state) => state.trust?.parent ?? null);
  const trusting = useFolderAccessStore((state) => state.trusting);
  const grant = useFolderAccessStore((state) => state.grant);
  const hide = useFolderAccessStore((state) => state.hideBanner);
  if (!restricted || hidden) return null;
  return (
    <div
      data-testid="folder-trust-banner"
      className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-primary/20 bg-primary/5 px-3 py-1.5 text-xs text-foreground"
    >
      <ShieldAlert aria-hidden className="size-3.5 shrink-0 text-primary" />
      <p className="min-w-0 flex-1">{t(($) => $.shell.openedFolder.trust.banner)}</p>
      <span className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          className={cn(TRUST_BUTTON, "text-primary")}
          disabled={trusting !== null}
          onClick={() => void grant("folder")}
        >
          {trusting === "folder" ? (
            <Loader2 aria-hidden className="size-3 animate-spin motion-reduce:animate-none" />
          ) : null}
          {t(($) => $.shell.openedFolder.trust.trustFolder)}
        </button>
        {parent ? (
          <button
            type="button"
            className={TRUST_BUTTON}
            disabled={trusting !== null}
            onClick={() => void grant("parent")}
          >
            {trusting === "parent" ? (
              <Loader2 aria-hidden className="size-3 animate-spin motion-reduce:animate-none" />
            ) : null}
            {t(($) => $.shell.openedFolder.trust.trustParent)}
          </button>
        ) : null}
        <Tooltip label={t(($) => $.shell.openedFolder.trust.hide)}>
          <button
            type="button"
            aria-label={t(($) => $.shell.openedFolder.trust.hide)}
            className={cn(TRUST_BUTTON, "px-1 text-muted-foreground hover:text-foreground")}
            onClick={hide}
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </Tooltip>
      </span>
    </div>
  );
}

function ReadOnlyBanner({ projectId }: Readonly<{ projectId: string }>) {
  const { t } = useTranslation(["shell"]);
  const readOnly = useFolderAccessStore((state) => folderIsReadOnly(state, projectId));
  const [copying, setCopying] = useState(false);
  if (!readOnly) return null;
  const copy = async () => {
    if (copying) return;
    setCopying(true);
    try {
      const copied = await copyLinkedIntoLibrary(projectId);
      await useFilesStore.getState().openProject(copied);
      toast.success(t(($) => $.shell.openedFolder.readOnly.copied));
    } catch (error) {
      notifyError(
        "copy folder into library",
        error,
        decodeAppError(error) ? undefined : t(($) => $.shell.openedFolder.readOnly.copyFailed),
      );
    } finally {
      setCopying(false);
    }
  };
  return (
    <div
      data-testid="folder-read-only-banner"
      className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400"
    >
      <Lock aria-hidden className="size-3.5 shrink-0" />
      <p className="min-w-0 flex-1">{t(($) => $.shell.openedFolder.readOnly.banner)}</p>
      <button
        type="button"
        className={READ_ONLY_BUTTON}
        disabled={copying}
        onClick={() => void copy()}
      >
        {copying ? (
          <Loader2 aria-hidden className="size-3 animate-spin motion-reduce:animate-none" />
        ) : null}
        {t(($) => $.shell.openedFolder.readOnly.copy)}
      </button>
    </div>
  );
}

export function OpenedFolderBanners() {
  const projectId = useFilesStore((state) => state.projectId);
  const reachable = useFolderReachable(projectId);
  if (!projectId || !reachable) return null;
  return (
    <>
      <ReadOnlyBanner projectId={projectId} />
      <TrustBanner projectId={projectId} />
    </>
  );
}
