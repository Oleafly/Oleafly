import { useCallback, useState } from "react";
import { History, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";
import { CheckpointsPanel } from "@/components/editor/CheckpointsPanel";
import { GitHistoryPanel } from "@/components/editor/GitHistoryPanel";
import { useSettingsStore } from "@/store/settings";

export function VersioningModal() {
  const open = useSettingsStore((state) => state.versioningOpen);
  const tab = useSettingsStore((state) => state.versioningTab);
  const setTab = useSettingsStore((state) => state.setVersioningTab);
  const closeVersioning = useSettingsStore((state) => state.closeVersioning);
  const [checkpointsBusy, setCheckpointsBusy] = useState(false);
  const close = useCallback(() => {
    if (!checkpointsBusy) closeVersioning();
  }, [checkpointsBusy, closeVersioning]);
  const { dialogRef, onBackdropMouseDown } = useModalAccessibility<HTMLDivElement>(open, close);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Dismiss versioning"
        className="absolute inset-0"
        onMouseDown={onBackdropMouseDown}
      />
      <div
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="versioning-title"
        className="relative flex h-[min(42rem,88vh)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl"
      >
        <header className="flex shrink-0 items-center gap-3 px-4 py-4">
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
          >
            <History className="size-4" />
          </span>
          <h2 id="versioning-title" className="min-w-0 flex-1 text-base font-semibold">
            Versioning
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Close versioning"
            disabled={checkpointsBusy}
            onClick={close}
          >
            <X className="size-4" />
          </Button>
        </header>

        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (value === "git" || value === "checkpoints") setTab(value);
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex shrink-0 justify-center px-4 pb-3">
            <TabsList aria-label="Versioning views">
              <TabsTrigger
                value="git"
                data-testid="versioning-tab-git"
                disabled={checkpointsBusy}
                onClick={() => setTab("git")}
              >
                Git History
              </TabsTrigger>
              <TabsTrigger
                value="checkpoints"
                data-testid="versioning-tab-checkpoints"
                onClick={() => setTab("checkpoints")}
              >
                Saved Checkpoints
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent
            value="git"
            data-testid="versioning-panel-git"
            className="flex min-h-0 flex-1 flex-col"
          >
            <GitHistoryPanel />
          </TabsContent>
          <TabsContent
            value="checkpoints"
            data-testid="versioning-panel-checkpoints"
            className="flex min-h-0 flex-1 flex-col"
          >
            <CheckpointsPanel onBusyChange={setCheckpointsBusy} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
