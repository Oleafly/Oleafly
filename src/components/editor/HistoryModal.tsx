import { useEffect, useState } from "react";
import { History, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/store/settings";
import { useFilesStore } from "@/store/files";
import { gitLog, type GitCommit } from "@/lib/tauri";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";

export function HistoryModal() {
  const open = useSettingsStore((s) => s.historyOpen);
  const setOpen = useSettingsStore((s) => s.setHistoryOpen);
  const projectId = useFilesStore((s) => s.projectId);
  const restoreFromGit = useFilesStore((s) => s.restoreFromGit);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmOid, setConfirmOid] = useState<string | null>(null);
  const { dialogRef, onBackdropMouseDown } = useModalAccessibility<HTMLDivElement>(open, () => setOpen(false));

  useEffect(() => {
    if (!open || !projectId) return;
    void gitLog(projectId).then(setCommits).catch(() => setCommits([]));
    setConfirmOid(null);
  }, [open, projectId]);

  if (!open) return null;

  const restore = async (oid: string) => {
    setBusy(true);
    try {
      await restoreFromGit(oid);
      setOpen(false);
    } finally {
      setBusy(false);
      setConfirmOid(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <button type="button" aria-label="Close history" className="absolute inset-0" onMouseDown={onBackdropMouseDown} />
      <div
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="history-title"
        className="relative flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border bg-popover text-popover-foreground shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b p-4">
          <History className="size-4" />
          <h2 id="history-title" className="text-base font-semibold">History</h2>
          <span className="ml-auto text-xs text-muted-foreground">Git</span>
        </div>
        <div className="flex-1 overflow-auto p-2">
          {commits.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No history yet. Compile to snapshot your work.
            </p>
          )}
          {commits.map((c) => (
            <div
              key={c.oid}
              className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{c.message}</div>
                <div className="font-mono text-xs text-muted-foreground">
                  {new Date(c.time * 1000).toLocaleString()} · {c.short}
                </div>
              </div>
              {confirmOid === c.oid ? (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={() => void restore(c.oid)}
                    title="Overwrite all files with this version"
                  >
                    Overwrite all
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setConfirmOid(null)}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirmOid(c.oid)}
                  title="Restore this version (overwrites all files)"
                >
                  <RotateCcw className="size-3.5" />
                  Restore
                </Button>
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-end border-t p-3">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
