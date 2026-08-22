import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/store/settings";
import { ProjectInfoContent } from "@/components/editor/ProjectInfo";
import {
  collectProjectInfo,
  type ProjectInfoSnapshot,
} from "@/components/editor/project-info-data";
import { isWysiwygActive } from "@/components/editor/wysiwyg/controller";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";

/**
 * The command-palette route into Project info. It renders the same content as
 * the toolbar popover so the two can never drift apart; only the chrome around
 * it differs.
 */
export function WordCountModal() {
  const open = useSettingsStore((s) => s.wordCountOpen);
  const setOpen = useSettingsStore((s) => s.setWordCountOpen);
  const [snapshot, setSnapshot] = useState<ProjectInfoSnapshot | null>(null);
  const { dialogRef, onBackdropMouseDown } = useModalAccessibility<HTMLDivElement>(
    open,
    () => setOpen(false),
  );

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close project info"
        className="absolute inset-0"
        onMouseDown={onBackdropMouseDown}
      />
      <div
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="project-info-title"
        className="relative w-full max-w-sm rounded-xl border bg-popover p-5 text-popover-foreground shadow-2xl"
      >
        <div id="project-info-title">
          <ProjectInfoContent
            snapshot={snapshot}
            surface={isWysiwygActive() ? "visual" : "source"}
          />
        </div>
        <div className="mt-4 flex justify-end">
          <Button data-modal-initial-focus size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
