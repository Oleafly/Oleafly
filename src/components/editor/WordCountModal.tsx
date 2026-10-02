import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/store/settings";
import { ProjectInfoContent } from "@/components/editor/ProjectInfo";
import {
  collectProjectInfo,
  type ProjectInfoSnapshot,
} from "@/components/editor/project-info-data";
import { isWysiwygActive } from "@/components/editor/wysiwyg/controller";
import { ModalShell } from "@/components/ui/modal-shell";

/**
 * The command-palette route into Project info. It renders the same content as
 * the toolbar popover so the two can never drift apart; only the chrome around
 * it differs.
 */
export function WordCountModal() {
  const { t } = useTranslation(["common", "editor"]);
  const open = useSettingsStore((s) => s.wordCountOpen);
  const setOpen = useSettingsStore((s) => s.setWordCountOpen);
  const [snapshot, setSnapshot] = useState<ProjectInfoSnapshot | null>(null);

  useEffect(() => {
    if (!open) {
      setSnapshot(null);
      return;
    }
    let live = true;
    void collectProjectInfo()
      .then((next) => {
        if (live) setSnapshot(next);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open]);

  if (!open) return null;

  return (
    <ModalShell
      open
      onClose={() => setOpen(false)}
      closeLabel={t(($) => $.editor.wordCount.close)}
      width="sm"
      labelledBy="project-info-title"
      className="p-5"
    >
      <div id="project-info-title">
        <ProjectInfoContent
          snapshot={snapshot}
          surface={isWysiwygActive() ? "visual" : "source"}
        />
      </div>
      <div className="mt-4 flex justify-end">
        <Button data-modal-initial-focus size="sm" onClick={() => setOpen(false)}>
          {t(($) => $.common.actions.close)}
        </Button>
      </div>
    </ModalShell>
  );
}
