import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  History,
  Pencil,
  RotateCcw,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
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
  const [labelBusyOid, setLabelBusyOid] = useState<string | null>(null);
  const [copiedOid, setCopiedOid] = useState<string | null>(null);
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
    setLabelBusyOid(oid);
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
      setLabelBusyOid(null);
    }
  };

  const removeLabel = async (oid: string) => {
    if (!projectId) return;
    setLabelBusyOid(oid);
    try {
      await gitSetVersionLabel(projectId, oid, "");
      setLabels((prev) => {
        const next = { ...prev };
        delete next[oid];
        return next;
      });
      if (editingOid === oid) setEditingOid(null);
    } catch (e) {
      notifyError("remove version label", e, "Could not remove that label.");
    } finally {
      setLabelBusyOid(null);
    }
  };

  const copyCommitId = async (c: GitCommit) => {
    try {
      await navigator.clipboard.writeText(c.oid);
      setCopiedOid(c.oid);
      window.setTimeout(() => {
        setCopiedOid((current) => (current === c.oid ? null : current));
      }, 1500);
    } catch (e) {
      notifyError("copy commit ID", e, "Could not copy that commit ID.");
    }
  };

  function CommitRow({ c, showRemoveLabel }: { c: GitCommit; showRemoveLabel: boolean }) {
    const manualLabel = labels[c.oid];
    const label = manualLabel ?? defaultLabels.get(c.oid) ?? "Version";
    const editing = editingOid === c.oid;
    const labelBusy = labelBusyOid === c.oid;
    return (
      <div className="group relative flex items-start gap-3 rounded-md py-3 pl-10 pr-2 hover:bg-accent/60">
        <span
          aria-hidden
          className="absolute left-[14px] top-[18px] z-10 size-2.5 rounded-full border-2 border-popover bg-primary ring-1 ring-primary/35"
        />
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-1">
              <Input
                autoFocus
                aria-label="Version label"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveLabel(c.oid);
                  if (e.key === "Escape") setEditingOid(null);
                }}
                placeholder="Label this version…"
                className="h-7 text-sm"
              />
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="Save label"
                disabled={labelBusy}
                onClick={() => void saveLabel(c.oid)}
              >
                <Check className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label="Cancel label editing"
                disabled={labelBusy}
                onClick={() => setEditingOid(null)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium">{label}</span>
              <Tooltip label="Edit label" side="top">
                <button
                  type="button"
                  aria-label={`Edit label for ${c.short}`}
                  onClick={() => startEdit(c)}
                  className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Pencil className="size-3" />
                </button>
              </Tooltip>
              {showRemoveLabel && manualLabel ? (
                <Tooltip label="Remove label" side="top">
                  <button
                    type="button"
                    aria-label={`Remove label ${manualLabel}`}
                    disabled={labelBusy}
                    onClick={() => void removeLabel(c.oid)}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </Tooltip>
              ) : null}
            </div>
          )}
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{c.message}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>{new Date(c.time * 1000).toLocaleString()}</span>
            <span aria-hidden>·</span>
            <Tooltip
              label={copiedOid === c.oid ? "Commit ID copied" : "Copy full commit ID"}
              side="top"
            >
              <button
                type="button"
                aria-label={`Copy commit ID ${c.short}`}
                onClick={() => void copyCommitId(c)}
                className="inline-flex items-center gap-1 rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-foreground/80 hover:border-primary/40 hover:bg-accent hover:text-foreground"
              >
                {c.short}
                {copiedOid === c.oid ? (
                  <Check className="size-2.5 text-emerald-500" />
                ) : (
                  <Copy className="size-2.5 opacity-60" />
                )}
              </button>
            </Tooltip>
            {manualLabel ? (
              <Tooltip label={`Labeled “${manualLabel}”`} side="top">
                <Tag
                  aria-label={`Labeled ${manualLabel}`}
                  className="size-3 text-primary"
                />
              </Tooltip>
            ) : null}
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

  function CommitList({ items, labelsOnly = false }: { items: GitCommit[]; labelsOnly?: boolean }) {
    if (items.length === 0) {
      return labelsOnly ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No labeled versions yet. Add a label from All History.
        </p>
      ) : emptyState;
    }

    return (
      <div className="relative py-1">
        {items.length > 1 ? (
          <span
            data-testid="history-graph-rail"
            aria-hidden
            className="absolute bottom-6 left-[18px] top-6 w-px bg-primary/40"
          />
        ) : null}
        {items.map((c) => (
          <CommitRow key={c.oid} c={c} showRemoveLabel={labelsOnly} />
        ))}
      </div>
    );
  }

  const emptyState = (
    <p className="py-8 text-center text-sm text-muted-foreground">
      No history yet. Compile to snapshot your work.
    </p>
  );
  const labeledCommits = commits.filter((c) => Boolean(labels[c.oid]?.trim()));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
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
            aria-label="Close version history"
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
            <CommitList items={commits} />
          </TabsContent>
          <TabsContent value="labels" className="min-h-0 flex-1 overflow-auto p-2">
            <CommitList items={labeledCommits} labelsOnly />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
