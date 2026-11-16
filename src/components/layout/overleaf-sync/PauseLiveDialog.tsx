import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { FileList } from "./FileList";

export function PauseLiveDialog({
  unsent,
  busy,
  onKeepLive,
  onPauseAnyway,
}: Readonly<{ unsent: readonly string[]; busy: boolean; onKeepLive: () => void; onPauseAnyway: () => void }>) {
  const { t } = useTranslation(["shell"]);
  return (
    <Dialog open={unsent.length > 0} onOpenChange={(next) => !next && onKeepLive()}>
      <DialogContent data-testid="overleaf-pause-dialog" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(($) => $.shell.overleafLive.pauseDialog.title)}</DialogTitle>
          <DialogDescription>{t(($) => $.shell.overleafLive.pauseDialog.description)}</DialogDescription>
        </DialogHeader>
        <FileList files={unsent} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onKeepLive}>
            {t(($) => $.shell.overleafLive.pauseDialog.keepLive)}
          </Button>
          <Button type="button" data-testid="overleaf-pause-anyway" disabled={busy} onClick={onPauseAnyway}>
            {busy ? <Spinner size="sm" /> : null}
            {t(($) => $.shell.overleafLive.pauseDialog.pauseAnyway)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
