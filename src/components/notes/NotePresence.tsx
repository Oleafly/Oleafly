import { useTranslation } from "react-i18next";
import { NoteLiveSlot } from "@/components/collab/CollabSlots";
import { Button } from "@/components/ui/button";
import { NoteShareButton } from "./NoteShareButton";
import { makeNoteLive, type NoteLiveMode } from "./use-note-live";

export function NoteLiveHint({ noteId }: Readonly<{ noteId: string }>) {
  const { t } = useTranslation(["notes"]);
  return (
    <span data-note-live-elsewhere className="flex items-center gap-2 pr-1 text-xs text-muted-foreground">
      <span>{t(($) => $.notes.live.elsewhere)}</span>
      <Button variant="outline" size="xs" onClick={() => makeNoteLive(noteId)}>
        {t(($) => $.notes.live.makeLive)}
      </Button>
    </span>
  );
}

export function NoteLiveHeader({
  noteId,
  mode,
  onShare,
}: Readonly<{ noteId: string; mode: NoteLiveMode; onShare?: () => void }>) {
  return (
    <>
      {mode === "elsewhere" && <NoteLiveHint noteId={noteId} />}
      {(mode === "live" || mode === "connecting") && <NoteLiveSlot noteId={noteId} live={mode === "live"} />}
      {onShare && <NoteShareButton onShare={onShare} />}
    </>
  );
}
