import { Eye, UserX, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { WorkspaceBanner, WorkspaceBannerButton } from "@/components/ui/workspace-banner";
import { useFilesStore } from "@/store/files";
import { useCollabLiveStore, type AccessNotice } from "./live-store";

type Translate = ReturnType<typeof useTranslation<["collab", "common"]>>["t"];

function noticeText(notice: AccessNotice, t: Translate): string {
  const name = notice.byName;
  if (notice.kind === "viewer") {
    return name ? t(($) => $.collab.access.viewerBy, { name }) : t(($) => $.collab.access.viewer);
  }
  return name ? t(($) => $.collab.access.removedBy, { name }) : t(($) => $.collab.access.removed);
}

export function AccessChangeBanner() {
  const { t } = useTranslation(["collab", "common"]);
  const projectId = useFilesStore((state) => state.projectId);
  const notice = useCollabLiveStore((state) =>
    projectId !== null && state.projectId === projectId ? state.accessNotice : null,
  );
  if (!notice) return null;
  const tone = notice.kind === "removed" ? "warning" : "primary";
  const Icon = notice.kind === "removed" ? UserX : Eye;
  return (
    <WorkspaceBanner tone={tone} role="status" data-testid="collab-access-banner">
      <Icon aria-hidden className={tone === "primary" ? "size-3.5 shrink-0 text-primary" : "size-3.5 shrink-0"} />
      <p className="min-w-0 flex-1">{noticeText(notice, t)}</p>
      <WorkspaceBannerButton
        tone={tone}
        aria-label={t(($) => $.common.actions.close)}
        onClick={() => useCollabLiveStore.getState().dismissAccessNotice()}
      >
        <X aria-hidden className="size-3.5" />
      </WorkspaceBannerButton>
    </WorkspaceBanner>
  );
}
