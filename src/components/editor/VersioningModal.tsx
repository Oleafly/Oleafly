import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { History, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModalShell } from "@/components/ui/modal-shell";
import { CheckpointsPanel } from "@/components/editor/CheckpointsPanel";
import { useSettingsStore } from "@/store/settings";

export function VersioningModal() {
  const { t } = useTranslation(["common", "editor"]);
  const open = useSettingsStore((state) => state.versioningOpen);
  const closeVersioning = useSettingsStore((state) => state.closeVersioning);
  const [checkpointsBusy, setCheckpointsBusy] = useState(false);
  const close = useCallback(() => {
    if (!checkpointsBusy) closeVersioning();
  }, [checkpointsBusy, closeVersioning]);

  if (!open) return null;

  return (
    <ModalShell
      open
      onClose={close}
      closeLabel={t(($) => $.editor.versioning.dismiss)}
      width="2xl"
      labelledBy="versioning-title"
      className="flex h-[min(42rem,88vh)] flex-col overflow-hidden"
    >
      <header className="flex shrink-0 items-center gap-3 px-4 py-4">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
        >
          <History className="size-4" />
        </span>
        <h2 id="versioning-title" className="min-w-0 flex-1 text-base font-semibold">
          {t(($) => $.editor.versioning.title)}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t(($) => $.editor.versioning.close)}
          disabled={checkpointsBusy}
          onClick={close}
        >
          <X className="size-4" />
        </Button>
      </header>

      <div
        data-testid="versioning-panel-checkpoints"
        className="flex min-h-0 flex-1 flex-col"
      >
        <CheckpointsPanel onBusyChange={setCheckpointsBusy} />
      </div>
    </ModalShell>
  );
}
