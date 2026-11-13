import { TriangleAlert, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { WorkspaceBanner, WorkspaceBannerButton } from "@/components/ui/workspace-banner";
import { dismissNoteLiveNotice, useCollabNoteNotices } from "@/lib/collab-live-bridge";

export function NoteLiveNotice({ noteId }: Readonly<{ noteId: string }>) {
  const { t } = useTranslation(["notes", "common"]);
  const notice = useCollabNoteNotices((state) => state.notices[noteId] ?? null);
  if (notice === null) return null;
  return (
    <WorkspaceBanner tone="warning" role="alert" data-testid="note-live-notice" data-note-live-notice={notice}>
      <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        {notice === "read_only" ? t(($) => $.notes.live.unsentReadOnly) : t(($) => $.notes.live.unsentRefused)}
      </span>
      <WorkspaceBannerButton
        tone="warning"
        aria-label={t(($) => $.common.actions.close)}
        onClick={() => dismissNoteLiveNotice(noteId)}
      >
        <X aria-hidden className="size-3.5" />
      </WorkspaceBannerButton>
    </WorkspaceBanner>
  );
}
