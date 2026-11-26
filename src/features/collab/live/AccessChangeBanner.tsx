import { useState } from "react";
import {
  Ban,
  CircleAlert,
  ExternalLink,
  Eye,
  MessageSquare,
  PencilLine,
  Unlink,
  UserX,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Spinner } from "@/components/ui/spinner";
import { WorkspaceBanner, WorkspaceBannerButton, type WorkspaceBannerTone } from "@/components/ui/workspace-banner";
import { overleafLiveActions } from "@/lib/collab-live-bridge";
import { logError } from "@/lib/log";
import { openOverleafProject } from "@/lib/overleaf-live";
import { useFilesStore } from "@/store/files";
import { DismissButton } from "./DismissButton";
import { type AccessNotice, type CollabLiveStoreState, useCollabLiveStore } from "./live-store";

type Translate = ReturnType<typeof useTranslation<["collab", "common"]>>["t"];

type OnlineNotice = "removedOnline" | "projectDeleted" | "viewOnly" | "deletedExternally";

type Shown = AccessNotice | OnlineNotice;

const ICONS: Readonly<Record<AccessNotice["kind"] | OnlineNotice, LucideIcon>> = {
  viewer: Eye,
  commenter: MessageSquare,
  reviewer: PencilLine,
  removed: UserX,
  removedOnline: UserX,
  projectDeleted: Ban,
  viewOnly: Eye,
  deletedExternally: Unlink,
};

function shownNotice(state: CollabLiveStoreState): Shown | null {
  const link = state.backend === "overleaf" ? state.overleaf : null;
  if (link !== null && state.ended === "removed") return "removedOnline";
  if (link !== null && state.ended === "project_deleted") return "projectDeleted";
  if (state.accessNotice && !(state.backend === "overleaf" && state.accessNotice.kind === "removed")) {
    return state.accessNotice;
  }
  if (link === null || state.ended !== null || state.accessNotice !== null) return null;
  if (state.role === "viewer") return "viewOnly";
  if (state.deletedExternally) return "deletedExternally";
  return null;
}

function noticeText(notice: Shown, t: Translate): string {
  if (typeof notice === "string") {
    switch (notice) {
      case "removedOnline":
        return t(($) => $.collab.access.removedOverleaf);
      case "projectDeleted":
        return t(($) => $.collab.access.projectDeleted);
      case "viewOnly":
        return t(($) => $.collab.access.viewOnly);
      case "deletedExternally":
        return t(($) => $.collab.access.deletedExternally);
    }
  }
  const name = notice.byName;
  switch (notice.kind) {
    case "viewer":
      return name ? t(($) => $.collab.access.viewerBy, { name }) : t(($) => $.collab.access.viewer);
    case "commenter":
      return name ? t(($) => $.collab.access.commenterBy, { name }) : t(($) => $.collab.access.commenter);
    case "reviewer":
      return name ? t(($) => $.collab.access.reviewerBy, { name }) : t(($) => $.collab.access.reviewer);
    case "removed":
      return name ? t(($) => $.collab.access.removedBy, { name }) : t(($) => $.collab.access.removed);
  }
}

function askForAccess() {
  const link = useCollabLiveStore.getState().overleaf;
  if (link) void openOverleafProject(link);
}

export function AccessChangeBanner() {
  const { t } = useTranslation(["collab", "common"]);
  const projectId = useFilesStore((state) => state.projectId);
  const notice = useCollabLiveStore((state) =>
    projectId !== null && state.projectId === projectId ? shownNotice(state) : null,
  );
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const online = typeof notice === "string";
  const key = `${projectId}:${online ? notice : ""}`;
  if (notice === null || projectId === null || (online && dismissed.includes(key))) return null;
  const kind = online ? notice : notice.kind;
  const ended = kind === "removed" || kind === "removedOnline" || kind === "projectDeleted";
  const tone: WorkspaceBannerTone = ended ? "warning" : "primary";
  const Icon = ICONS[kind];
  const keepLocal = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await overleafLiveActions().unlink(projectId);
    } catch (error) {
      void logError("keep overleaf project local", error);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  const dismiss = () => {
    if (online) setDismissed((keys) => [...keys, key]);
    else useCollabLiveStore.getState().dismissAccessNotice();
  };
  const keeps = kind === "removedOnline" || kind === "projectDeleted";
  const onlineName = notice === "removedOnline" ? "removed" : notice;
  return (
    <WorkspaceBanner
      tone={tone}
      role="status"
      data-testid={online ? `overleaf-access-banner-${onlineName}` : "collab-access-banner"}
    >
      <Icon aria-hidden className={ended ? "size-3.5 shrink-0" : "size-3.5 shrink-0 text-primary"} />
      <p className="min-w-0 flex-1">{noticeText(notice, t)}</p>
      <span className="flex shrink-0 items-center gap-1">
        {keeps ? (
          <WorkspaceBannerButton tone={tone} disabled={busy} onClick={() => void keepLocal()}>
            {busy ? <Spinner size="xs" /> : null}
            {t(($) => $.collab.access.keepLocal)}
          </WorkspaceBannerButton>
        ) : null}
        {kind === "viewOnly" ? (
          <WorkspaceBannerButton tone={tone} className="text-primary" onClick={askForAccess}>
            <ExternalLink aria-hidden className="size-3.5" />
            {t(($) => $.collab.access.askOnOverleaf)}
          </WorkspaceBannerButton>
        ) : null}
        <DismissButton tone={tone} label={t(($) => $.common.actions.close)} onDismiss={dismiss} />
      </span>
      {failed && keeps ? (
        <p role="alert" className="flex w-full items-center gap-2 font-medium">
          <CircleAlert aria-hidden className="size-3.5 shrink-0" />
          {t(($) => $.collab.access.keepLocalFailed)}
        </p>
      ) : null}
    </WorkspaceBanner>
  );
}
