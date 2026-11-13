import { Share2, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShareDialog } from "@/components/collab/share-dialog";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { cn } from "@/lib/utils";
import { RowMark } from "./NoteListItem";

export function shareNote(noteId: string): void {
  useShareDialog.getState().openFor(noteId);
}

export function NoteShareButton({ onShare }: Readonly<{ onShare: () => void }>) {
  const { t } = useTranslation(["notes"]);
  const label = t(($) => $.notes.live.share);
  return (
    <TooltipIconButton label={label} onClick={onShare}>
      <Share2 aria-hidden className="size-4" />
    </TooltipIconButton>
  );
}

export function SharedMark({ className }: Readonly<{ className?: string }>) {
  const { t } = useTranslation(["notes"]);
  return <RowMark label={t(($) => $.notes.live.shared)} icon={Users} data-note-shared="" className={cn("text-muted-foreground", className)} />;
}
