import { X } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { useTranslation } from "react-i18next";
import { dismissNoteLiveNotice, useCollabNoteNotices } from "@/lib/collab-live-bridge";
import { cn } from "@/lib/utils";

export function NoteLiveNotice({ noteId, className }: Readonly<{ noteId: string; className?: string }>) {
  const { t } = useTranslation(["notes", "common"]);
  const notice = useCollabNoteNotices((state) => state.notices[noteId] ?? null);
  if (notice === null) return null;
  const text = notice === "read_only" ? t(($) => $.notes.live.unsentReadOnly) : t(($) => $.notes.live.unsentRefused);
  return (
    <span
      role="alert"
      data-testid="note-live-notice"
      data-note-live-notice={notice}
      className={cn("flex min-w-0 items-center gap-1 text-xs text-destructive", className)}
    >
      <Tooltip label={text} className="min-w-0">
        <span className="block truncate">{text}</span>
      </Tooltip>
      <button
        type="button"
        aria-label={t(($) => $.common.actions.close)}
        onClick={() => dismissNoteLiveNotice(noteId)}
        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
      >
        <X aria-hidden className="size-3" />
      </button>
    </span>
  );
}
