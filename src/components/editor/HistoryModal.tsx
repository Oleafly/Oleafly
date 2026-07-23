import { useEffect, useMemo, useState } from "react";
import { Check, History, Pencil, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSettingsStore } from "@/store/settings";
import { useFilesStore } from "@/store/files";
import { gitLog, gitReadVersionLabels, gitSetVersionLabel, type GitCommit } from "@/lib/tauri";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";
import { notifyError } from "@/lib/toast";

function deriveDefaultLabels(commits: GitCommit[]): Map<string, string> {
  const chronological = [...commits].reverse();
  let compileCount = 0;
  const result = new Map<string, string>();
  for (const c of chronological) {
    if (c.message.startsWith("Update:")) {
      compileCount++;
      result.set(c.oid, `Compile V${compileCount}`);
    } else if (c.message === "Oleafly AI checkpoint") {
      result.set(c.oid, "AI checkpoint");
    } else {
      result.set(c.oid, "Manual Commit");
    }
  }
  return result;
}

export function HistoryModal() {
  const open = useSettingsStore((s) => s.historyOpen);
  const setOpen = useSettingsStore((s) => s.setHistoryOpen);
  const projectId = useFilesStore((s) => s.projectId);
  const restoreFromGit = useFilesStore((s) => s.restoreFromGit);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmOid, setConfirmOid] = useState<string | null>(null);
  const [editingOid, setEditingOid] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const { dialogRef, onBackdropMouseDown } = useModalAccessibility<HTMLDivElement>(open, () => setOpen(false));

  useEffect(() => {
    if (!open || !projectId) return;
    void gitLog(projectId).then(setCommits).catch(() => setCommits([]));
    void gitReadVersionLabels(projectId).then(setLabels).catch(() => setLabels({}));
    setConfirmOid(null);
    setEditingOid(null);
  }, [open, projectId]);

  const defaultLabels = useMemo(() => deriveDefaultLabels(commits), [commits]);

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

  const startEdit = (c: GitCommit) => {
    setEditingOid(c.oid);
    setEditValue(labels[c.oid] ?? defaultLabels.get(c.oid) ?? "");
  };

  const saveLabel = async (oid: string) => {
    if (!projectId) return;
    const value = editValue.trim();
    try {
      await gitSetVersionLabel(projectId, oid, value);
      setLabels((prev) => {
        const next = { ...prev };
        if (value) next[oid] = value;
        else delete next[oid];
        return next;
      });
    } catch (e) {
      notifyError("save version label", e, "Could not save that label.");
    } finally {
      setEditingOid(null);
    }
  };

  function CommitRow({ c, editable }: { c: GitCommit; editable: boolean }) {
    const label = labels[c.oid] ?? defaultLabels.get(c.oid);
    const editing = editable && editingOid === c.oid;
    return (
      <div className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-1">
              <Input
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveLabel(c.oid);
                  if (e.key === "Escape") setEditingOid(null);
                }}
                placeholder="Label this version…"
                className="h-7 text-sm"
              />
              <Button variant="ghost" size="icon" className="size-7" onClick={() => void saveLabel(c.oid)}>
                <Check className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditingOid(null)}>
                <X className="size-3.5" />
              </Button>
            </div>
          ) : editable ? (
            <button
              type="button"
              onClick={() => startEdit(c)}
              className="group flex w-full items-center gap-1.5 text-left"
            >
              <span className="truncate text-sm font-medium">{label}</span>
              <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ) : (
            <span className="block truncate text-sm font-medium">{label}</span>
          )}
          <div className="truncate text-xs text-muted-foreground">{c.message}</div>
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
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmOid(null)}>
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
    );
  }

  const emptyState = (
    <p className="py-8 text-center text-sm text-muted-foreground">
      No history yet. Compile to snapshot your work.
    </p>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <button type="button" aria-label="Close history" className="absolute inset-0" onMouseDown={onBackdropMouseDown} />
      <div
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="history-title"
        className="relative flex h-[min(30rem,80vh)] w-full max-w-lg flex-col rounded-xl border bg-popover text-popover-foreground shadow-2xl"
      >
        <div className="flex items-center gap-2 p-4">
          <History className="size-4" />
          <h2 id="history-title" className="text-base font-semibold">Version History</h2>
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">Git</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <Tabs defaultValue="all" className="flex min-h-0 flex-1 flex-col">
          <div className="flex justify-center px-4 py-3">
            <TabsList>
              <TabsTrigger value="all">All History</TabsTrigger>
              <TabsTrigger value="labels">Labels</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="all" className="min-h-0 flex-1 overflow-auto p-2">
            {commits.length === 0 && emptyState}
            {commits.map((c) => (
              <CommitRow key={c.oid} c={c} editable={false} />
            ))}
          </TabsContent>
          <TabsContent value="labels" className="min-h-0 flex-1 overflow-auto p-2">
            {commits.length === 0 && emptyState}
            {commits.map((c) => (
              <CommitRow key={c.oid} c={c} editable />
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
