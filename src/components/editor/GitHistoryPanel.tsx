import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Pencil, RotateCcw, Tag, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { useSettingsStore } from "@/store/settings";
import { useFilesStore } from "@/store/files";
import { gitLog, gitReadVersionLabels, gitSetVersionLabel, type GitCommit } from "@/lib/tauri";
import { notifyError } from "@/lib/toast";

type HistoryActionToken = {
  projectId: string;
  session: number;
  domain: string;
  request: number;
};

function gitTabIsActive(): boolean {
  const settings = useSettingsStore.getState();
  return settings.versioningOpen && settings.versioningTab === "git";
}

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

export function GitHistoryPanel() {
  const open = useSettingsStore((s) => s.versioningOpen && s.versioningTab === "git");
  const closeVersioning = useSettingsStore((s) => s.closeVersioning);
  const projectId = useFilesStore((s) => s.projectId);
  const restoreFromGit = useFilesStore((s) => s.restoreFromGit);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmOid, setConfirmOid] = useState<string | null>(null);
  const [editingOid, setEditingOid] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [labelBusyOids, setLabelBusyOids] = useState<Set<string>>(
    () => new Set(),
  );
  const [copiedOid, setCopiedOid] = useState<string | null>(null);
  const loadRequest = useRef(0);
  const sessionRequest = useRef(0);
  const actionRequests = useRef(new Map<string, number>());
  const copyTimer = useRef<number | null>(null);
  const renderedIdentity = useRef({ open, projectId });
  const renderIdentityChanged =
    renderedIdentity.current.open !== open ||
    renderedIdentity.current.projectId !== projectId;

  const isCurrentSession = useCallback(
    (targetProjectId: string | null, session: number) =>
      session === sessionRequest.current &&
      useFilesStore.getState().projectId === targetProjectId &&
      gitTabIsActive(),
    [],
  );

  const beginAction = useCallback(
    (targetProjectId: string, domain: string): HistoryActionToken | null => {
      if (renderIdentityChanged) return null;
      const request = (actionRequests.current.get(domain) ?? 0) + 1;
      actionRequests.current.set(domain, request);
      return {
        projectId: targetProjectId,
        session: sessionRequest.current,
        domain,
        request,
      };
    },
    [renderIdentityChanged],
  );

  const isCurrentAction = useCallback(
    (token: HistoryActionToken) =>
      token.request === actionRequests.current.get(token.domain) &&
      isCurrentSession(token.projectId, token.session),
    [isCurrentSession],
  );

  const loadHistory = useCallback(
    (targetProjectId: string | null, session: number) => {
      if (!isCurrentSession(targetProjectId, session)) return;
      const request = ++loadRequest.current;
      if (!targetProjectId) {
        setCommits([]);
        setLabels({});
        return;
      }
      void gitLog(targetProjectId)
        .then((nextCommits) => {
          if (
            request === loadRequest.current &&
            isCurrentSession(targetProjectId, session)
          ) {
            setCommits(nextCommits);
          }
        })
        .catch(() => {
          if (
            request === loadRequest.current &&
            isCurrentSession(targetProjectId, session)
          ) {
            setCommits([]);
          }
        });
      void gitReadVersionLabels(targetProjectId)
        .then((nextLabels) => {
          if (
            request === loadRequest.current &&
            isCurrentSession(targetProjectId, session)
          ) {
            setLabels(nextLabels);
          }
        })
        .catch(() => {
          if (
            request === loadRequest.current &&
            isCurrentSession(targetProjectId, session)
          ) {
            setLabels({});
          }
        });
    },
    [isCurrentSession],
  );

  useLayoutEffect(() => {
    renderedIdentity.current = { open, projectId };
    const session = ++sessionRequest.current;
    actionRequests.current.clear();
    loadRequest.current += 1;
    if (copyTimer.current !== null) {
      window.clearTimeout(copyTimer.current);
      copyTimer.current = null;
    }
    setCommits([]);
    setLabels({});
    setBusy(false);
    setConfirmOid(null);
    setEditingOid(null);
    setEditValue("");
    setLabelBusyOids(new Set());
    setCopiedOid(null);
    if (open) void loadHistory(projectId, session);
    return () => {
      sessionRequest.current += 1;
      actionRequests.current.clear();
      loadRequest.current += 1;
      if (copyTimer.current !== null) {
        window.clearTimeout(copyTimer.current);
        copyTimer.current = null;
      }
    };
  }, [open, projectId, loadHistory]);

  const visibleCommits = renderIdentityChanged ? [] : commits;
  const visibleLabels = renderIdentityChanged ? {} : labels;
  const defaultLabels = useMemo(
    () => deriveDefaultLabels(visibleCommits),
    [visibleCommits],
  );

  if (!open) return null;

  const restore = async (oid: string) => {
    if (!projectId) return;
    const action = beginAction(projectId, "restore");
    if (!action || !isCurrentAction(action)) return;
    setBusy(true);
    try {
      await restoreFromGit(action.projectId, oid);
      if (!isCurrentAction(action)) return;
      closeVersioning();
    } catch (error) {
      if (!isCurrentAction(action)) return;
      notifyError(
        "restore Git version",
        error,
        "Could not restore that Git version.",
      );
    } finally {
      if (isCurrentAction(action)) {
        setBusy(false);
        setConfirmOid(null);
      }
    }
  };

  const startEdit = (c: GitCommit) => {
    if (renderIdentityChanged) return;
    setEditingOid(c.oid);
    setEditValue(visibleLabels[c.oid] ?? defaultLabels.get(c.oid) ?? "");
  };

  const saveLabel = async (oid: string) => {
    if (!projectId) return;
    const action = beginAction(projectId, `label:${oid}`);
    if (!action || !isCurrentAction(action)) return;
    const value = editValue.trim();
    setLabelBusyOids((current) => new Set(current).add(oid));
    try {
      await gitSetVersionLabel(action.projectId, oid, value);
      if (!isCurrentAction(action)) return;
      setLabels((prev) => {
        const next = { ...prev };
        if (value) next[oid] = value;
        else delete next[oid];
        return next;
      });
    } catch (e) {
      if (!isCurrentAction(action)) return;
      notifyError("save version label", e, "Could not save that label.");
    } finally {
      if (isCurrentAction(action)) {
        setEditingOid((current) => (current === oid ? null : current));
        setLabelBusyOids((current) => {
          const next = new Set(current);
          next.delete(oid);
          return next;
        });
      }
    }
  };

  const removeLabel = async (oid: string) => {
    if (!projectId) return;
    const action = beginAction(projectId, `label:${oid}`);
    if (!action || !isCurrentAction(action)) return;
    setLabelBusyOids((current) => new Set(current).add(oid));
    try {
      await gitSetVersionLabel(action.projectId, oid, "");
      if (!isCurrentAction(action)) return;
      setLabels((prev) => {
        const next = { ...prev };
        delete next[oid];
        return next;
      });
      if (editingOid === oid) setEditingOid(null);
    } catch (e) {
      if (!isCurrentAction(action)) return;
      notifyError("remove version label", e, "Could not remove that label.");
    } finally {
      if (isCurrentAction(action)) {
        setLabelBusyOids((current) => {
          const next = new Set(current);
          next.delete(oid);
          return next;
        });
      }
    }
  };

  const copyCommitId = async (c: GitCommit) => {
    if (!projectId) return;
    const action = beginAction(projectId, "copy");
    if (!action || !isCurrentAction(action)) return;
    try {
      await navigator.clipboard.writeText(c.oid);
      if (!isCurrentAction(action)) return;
      setCopiedOid(c.oid);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => {
        copyTimer.current = null;
        if (!isCurrentAction(action)) return;
        setCopiedOid((current) => (current === c.oid ? null : current));
      }, 1500);
    } catch (e) {
      if (!isCurrentAction(action)) return;
      notifyError("copy commit ID", e, "Could not copy that commit ID.");
    }
  };

  function CommitRow({ c, showRemoveLabel }: { c: GitCommit; showRemoveLabel: boolean }) {
    const manualLabel = visibleLabels[c.oid];
    const label = manualLabel ?? defaultLabels.get(c.oid) ?? "Version";
    const editing = editingOid === c.oid;
    const labelBusy = labelBusyOids.has(c.oid);
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
      No Git history yet. Initialize Source Control, then commit when you want a version here.
    </p>
  );
  const labeledCommits = visibleCommits.filter((c) =>
    Boolean(visibleLabels[c.oid]?.trim()),
  );

  return (
    <Tabs defaultValue="all" className="flex min-h-0 flex-1 flex-col">
      <div className="flex justify-center px-4 pb-3">
        <TabsList>
          <TabsTrigger value="all">All History</TabsTrigger>
          <TabsTrigger value="labels">Labels</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="all" className="min-h-0 flex-1 overflow-auto p-2">
        <CommitList items={visibleCommits} />
      </TabsContent>
      <TabsContent value="labels" className="min-h-0 flex-1 overflow-auto p-2">
        <CommitList items={labeledCommits} labelsOnly />
      </TabsContent>
    </Tabs>
  );
}
