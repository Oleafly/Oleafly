import { FolderSync, FolderX } from "@/components/icons/pack";
import { useTranslation } from "react-i18next";
import { Spinner } from "@/components/ui/spinner";
import { WorkspaceBanner, WorkspaceBannerButton } from "@/components/ui/workspace-banner";
import type { CollabSyncDecision } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { folderReachable, useProjectAvailabilityStore } from "@/store/project-availability";
import { AccessChangeBanner } from "./AccessChangeBanner";
import { CommentsNotSentBanner } from "./CommentsNotSentBanner";
import { FileNoticesBanner } from "./FileNoticesBanner";
import { ProjectFullBanner } from "./ProjectFullBanner";
import { useSyncPauseStore } from "./sync-pause";

function UnavailableBanner() {
  const { t } = useTranslation(["shell"]);
  return (
    <WorkspaceBanner tone="warning" data-testid="collab-sync-unavailable-banner">
      <FolderX aria-hidden className="size-3.5 shrink-0" />
      <p className="min-w-0 flex-1">{t(($) => $.shell.collabSync.unavailable)}</p>
    </WorkspaceBanner>
  );
}

function DecisionBanner({ projectId, changed }: Readonly<{ projectId: string; changed: number }>) {
  const { t } = useTranslation(["shell"]);
  const deciding = useSyncPauseStore((state) => state.deciding);
  const pending = deciding?.projectId === projectId ? deciding.decision : null;
  const decide = useSyncPauseStore((state) => state.decide);
  const choose = (decision: CollabSyncDecision) => void decide(projectId, decision);
  return (
    <WorkspaceBanner tone="primary" data-testid="collab-sync-pause-banner">
      <FolderSync aria-hidden className="size-3.5 shrink-0 text-primary" />
      <p className="min-w-0 flex-1">{t(($) => $.shell.collabSync.paused, { count: changed })}</p>
      <span className="flex shrink-0 items-center gap-1">
        <WorkspaceBannerButton
          tone="primary"
          className="text-primary"
          disabled={deciding !== null}
          onClick={() => choose("send")}
        >
          {pending === "send" ? <Spinner size="xs" /> : null}
          {t(($) => $.shell.collabSync.send)}
        </WorkspaceBannerButton>
        <WorkspaceBannerButton tone="primary" disabled={deciding !== null} onClick={() => choose("keep_local")}>
          {pending === "keep_local" ? <Spinner size="xs" /> : null}
          {t(($) => $.shell.collabSync.keepLocal)}
        </WorkspaceBannerButton>
      </span>
    </WorkspaceBanner>
  );
}

export function SyncPauseBanner() {
  const projectId = useFilesStore((state) => state.projectId);
  const changed = useSyncPauseStore((state) => (projectId ? state.waiting[projectId] : undefined));
  const unavailable = useSyncPauseStore((state) => (projectId ? state.unavailable[projectId] === true : false));
  const reachable = useProjectAvailabilityStore(
    (state) => state.projectId !== projectId || folderReachable(state.availability),
  );
  if (!projectId) return null;
  if (unavailable) return reachable ? <UnavailableBanner /> : null;
  if (changed === undefined) return null;
  return <DecisionBanner projectId={projectId} changed={changed} />;
}

export function CollabBanners() {
  return (
    <>
      <AccessChangeBanner />
      <CommentsNotSentBanner />
      <SyncPauseBanner />
      <ProjectFullBanner />
      <FileNoticesBanner />
    </>
  );
}
