import { useTranslation } from "react-i18next";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/app-error";
import { cn } from "@/lib/utils";
import type { NoteSaveFailure, SaveStatus } from "./NoteDocument";

export interface NoteSaveStatusProps {
  status: SaveStatus;
  failure: NoteSaveFailure | null;
  className?: string;
}

export function NoteSaveStatus({ status, failure, className }: Readonly<NoteSaveStatusProps>) {
  const { t } = useTranslation(["notes"]);
  if (status === "failed") {
    const reason = failure ? describeError(failure.error) : "";
    const text = reason ? t(($) => $.notes.saveStatus.failedWithReason, { reason }) : t(($) => $.notes.saveStatus.failed);
    return (
      <span
        role="alert"
        data-note-save-status="failed"
        className={cn("flex min-w-0 items-center gap-1 text-xs text-destructive", className)}
      >
        <Tooltip label={text} className="min-w-0">
          <span className="block truncate">{text}</span>
        </Tooltip>
        {failure && (
          <Button variant="ghost" size="xs" className="shrink-0" onClick={failure.retry}>
            {t(($) => $.notes.saveStatus.retry)}
          </Button>
        )}
      </span>
    );
  }
  return (
    <span data-note-save-status={status} className={cn("text-xs text-muted-foreground", className)}>
      {status === "saving" ? t(($) => $.notes.saveStatus.saving) : t(($) => $.notes.saveStatus.saved)}
    </span>
  );
}
