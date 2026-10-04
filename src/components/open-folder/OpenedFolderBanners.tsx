import { useTranslation } from "react-i18next";
import { Lock, ShieldAlert, X } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { WorkspaceBanner, WorkspaceBannerButton } from "@/components/ui/workspace-banner";
import { copyIntoLibrary, useCopyIntoLibraryStore } from "@/store/copy-into-library";
import { useFilesStore } from "@/store/files";
import { folderIsReadOnly, folderIsRestricted, useFolderAccessStore } from "@/store/folder-access";
import { folderReachable, useProjectAvailabilityStore } from "@/store/project-availability";
import { Spinner } from "@/components/ui/spinner";

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
    <WorkspaceBanner tone="primary" data-testid="folder-trust-banner">
      <ShieldAlert aria-hidden className="size-3.5 shrink-0 text-primary" />
      <p className="min-w-0 flex-1">{t(($) => $.shell.openedFolder.trust.banner)}</p>
      <span className="flex shrink-0 items-center gap-1">
        <WorkspaceBannerButton
          tone="primary"
          className="text-primary"
          disabled={trusting !== null}
          onClick={() => void grant("folder")}
        >
          {trusting === "folder" ? (
            <Spinner size="xs" />
          ) : null}
          {t(($) => $.shell.openedFolder.trust.trustFolder)}
        </WorkspaceBannerButton>
        {parent ? (
          <WorkspaceBannerButton
            tone="primary"
            disabled={trusting !== null}
            onClick={() => void grant("parent")}
          >
            {trusting === "parent" ? (
              <Spinner size="xs" />
            ) : null}
            {t(($) => $.shell.openedFolder.trust.trustParent)}
          </WorkspaceBannerButton>
        ) : null}
        <Tooltip label={t(($) => $.shell.openedFolder.trust.hide)}>
          <WorkspaceBannerButton
            tone="primary"
            aria-label={t(($) => $.shell.openedFolder.trust.hide)}
            className="px-1 text-muted-foreground hover:text-foreground"
            onClick={hide}
          >
            <X aria-hidden className="size-3.5" />
          </WorkspaceBannerButton>
        </Tooltip>
      </span>
    </WorkspaceBanner>
  );
}

function ReadOnlyBanner({ projectId }: Readonly<{ projectId: string }>) {
  const { t } = useTranslation(["shell"]);
  const readOnly = useFolderAccessStore((state) => folderIsReadOnly(state, projectId));
  const projectName = useFilesStore((state) => state.projectName);
  const copying = useCopyIntoLibraryStore(
    (state) => state.status === "running" || state.status === "cancelling",
  );
  if (!readOnly) return null;
  const copy = () => {
    if (copying) return;
    void copyIntoLibrary(projectId, projectName ?? "", { openAfterCopy: true });
  };
  return (
    <WorkspaceBanner tone="warning" data-testid="folder-read-only-banner">
      <Lock aria-hidden className="size-3.5 shrink-0" />
      <p className="min-w-0 flex-1">{t(($) => $.shell.openedFolder.readOnly.banner)}</p>
      <WorkspaceBannerButton tone="warning" disabled={copying} onClick={copy}>
        {copying ? (
          <Spinner size="xs" />
        ) : null}
        {t(($) => $.shell.openedFolder.readOnly.copy)}
      </WorkspaceBannerButton>
    </WorkspaceBanner>
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
