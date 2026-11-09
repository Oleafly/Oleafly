import { Share2, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShareDialog } from "@/components/collab/share-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function shareNote(noteId: string): void {
  useShareDialog.getState().openFor(noteId);
}

export function NoteShareButton({ onShare }: Readonly<{ onShare: () => void }>) {
  const { t } = useTranslation(["notes"]);
  const label = t(($) => $.notes.live.share);
  return (
    <Tooltip label={label} side="bottom">
      <Button variant="ghost" size="icon" aria-label={label} className="relative size-7" onClick={onShare}>
        <Share2 aria-hidden className="size-4" />
      </Button>
    </Tooltip>
  );
}

export function SharedMark({ className }: Readonly<{ className?: string }>) {
  const { t } = useTranslation(["notes"]);
  const label = t(($) => $.notes.live.shared);
  return (
    <Tooltip label={label}>
      <span role="img" aria-label={label} data-note-shared className={cn("flex shrink-0 items-center text-muted-foreground", className)}>
        <Users aria-hidden className="size-3.5" />
      </span>
    </Tooltip>
  );
}
