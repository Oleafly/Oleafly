import { useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { Ban, CircleAlert, ExternalLink, Eye, PencilLine, Unlink, UserX, X, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Spinner } from "@/components/ui/spinner";
import { WorkspaceBanner, WorkspaceBannerButton, type WorkspaceBannerTone } from "@/components/ui/workspace-banner";
import { overleafLiveActions } from "@/lib/collab-live-bridge";
import { logError } from "@/lib/log";
import { overleafProjectPage } from "@/lib/overleaf-live";
import { useFilesStore } from "@/store/files";
import { type CollabLiveStoreState, useCollabLiveStore } from "./live-store";

type Notice = "removed" | "projectDeleted" | "viewOnly" | "reviewing" | "trackingChanges" | "deletedExternally";

type Translate = ReturnType<typeof useTranslation<["collab", "common"]>>["t"];

const ICONS: Readonly<Record<Notice, LucideIcon>> = {
  removed: UserX,
  projectDeleted: Ban,
  viewOnly: Eye,
  reviewing: PencilLine,
  trackingChanges: PencilLine,
  deletedExternally: Unlink,
};

function noticeOf(state: CollabLiveStoreState): Notice | null {
  if (state.overleaf === null) return null;
  if (state.ended === "removed") return "removed";
  if (state.ended === "project_deleted") return "projectDeleted";
  if (state.ended !== null || state.accessNotice !== null) return null;
  if (state.role === "viewer") return "viewOnly";
  if (state.role === "reviewer") return "reviewing";
  if (state.tracking) return "trackingChanges";
  if (state.deletedExternally) return "deletedExternally";
  return null;
}

function noticeText(notice: Notice, t: Translate): string {
  switch (notice) {
    case "removed":
      return t(($) => $.collab.access.removedOverleaf);
    case "projectDeleted":
      return t(($) => $.collab.access.projectDeleted);
    case "viewOnly":
      return t(($) => $.collab.access.viewOnly);
    case "reviewing":
      return t(($) => $.collab.access.reviewing);
    case "trackingChanges":
      return t(($) => $.collab.access.trackingChanges);
    case "deletedExternally":
      return t(($) => $.collab.access.deletedExternally);
  }
}

function askOnOverleaf() {
  const link = useCollabLiveStore.getState().overleaf;
  if (!link) return;
  openExternal(overleafProjectPage(link)).catch((error) => void logError("open overleaf project page", error));
}

export function OverleafAccessBanner() {
  const { t } = useTranslation(["collab", "common"]);
  const projectId = useFilesStore((state) => state.projectId);
  const notice = useCollabLiveStore((state) =>
    projectId !== null && state.projectId === projectId ? noticeOf(state) : null,
  );
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const key = `${projectId}:${notice}`;
  if (notice === null || projectId === null || dismissed.includes(key)) return null;
  const ended = notice === "removed" || notice === "projectDeleted";
  const tone: WorkspaceBannerTone = ended ? "warning" : "primary";
  const Icon = ICONS[notice];
  const keepLocal = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await overleafLiveActions()?.unlink(projectId);
    } catch (error) {
      void logError("keep overleaf project local", error);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <WorkspaceBanner tone={tone} role="status" data-testid={`overleaf-access-banner-${notice}`}>
      <Icon aria-hidden className={ended ? "size-3.5 shrink-0" : "size-3.5 shrink-0 text-primary"} />
      <p className="min-w-0 flex-1">{noticeText(notice, t)}</p>
      <span className="flex shrink-0 items-center gap-1">
        {ended ? (
          <WorkspaceBannerButton tone={tone} disabled={busy} onClick={() => void keepLocal()}>
            {busy ? <Spinner size="xs" /> : null}
            {t(($) => $.collab.access.keepLocal)}
          </WorkspaceBannerButton>
        ) : null}
        {notice === "viewOnly" ? (
          <WorkspaceBannerButton tone={tone} className="text-primary" onClick={askOnOverleaf}>
            <ExternalLink aria-hidden className="size-3.5" />
            {t(($) => $.collab.access.askOnOverleaf)}
          </WorkspaceBannerButton>
        ) : null}
        <WorkspaceBannerButton
          tone={tone}
          aria-label={t(($) => $.common.actions.close)}
          onClick={() => setDismissed((keys) => [...keys, key])}
        >
          <X aria-hidden className="size-3.5" />
        </WorkspaceBannerButton>
      </span>
      {failed && ended ? (
        <p role="alert" className="flex w-full items-center gap-2 font-medium">
          <CircleAlert aria-hidden className="size-3.5 shrink-0" />
          {t(($) => $.collab.access.keepLocalFailed)}
        </p>
      ) : null}
    </WorkspaceBanner>
  );
}
