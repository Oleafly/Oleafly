import { TriangleAlert, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { WorkspaceBanner, WorkspaceBannerButton } from "@/components/ui/workspace-banner";
import { describeError } from "@/lib/app-error";
import { cn } from "@/lib/utils";
import type { NoteSaveFailure, SaveStatus } from "./NoteDocument";

export function NoteSaveStatus({ status, className }: Readonly<{ status: SaveStatus; className?: string }>) {
  const { t } = useTranslation(["notes"]);
  if (status === "failed") return null;
  return (
    <span data-note-save-status={status} className={cn("text-xs text-muted-foreground", className)}>
      {status === "saving" ? t(($) => $.notes.saveStatus.saving) : t(($) => $.notes.saveStatus.saved)}
    </span>
  );
}

export function NoteSaveFailed({ failure, onDismiss }: Readonly<{ failure: NoteSaveFailure; onDismiss: () => void }>) {
  const { t } = useTranslation(["notes", "common"]);
  const reason = describeError(failure.error);
  return (
    <WorkspaceBanner tone="warning" role="alert" data-note-save-status="failed">
      <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        {reason ? t(($) => $.notes.saveStatus.failedWithReason, { reason }) : t(($) => $.notes.saveStatus.failed)}
      </span>
      <WorkspaceBannerButton tone="warning" onClick={failure.retry}>
        {t(($) => $.notes.saveStatus.retry)}
      </WorkspaceBannerButton>
      <WorkspaceBannerButton tone="warning" aria-label={t(($) => $.common.actions.close)} onClick={onDismiss}>
        <X aria-hidden className="size-3.5" />
      </WorkspaceBannerButton>
    </WorkspaceBanner>
  );
}
