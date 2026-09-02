import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { Check, Copy, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useSettingsStore } from "@/store/settings";
import { useFilesStore } from "@/store/files";
import { gitLog, type GitCommit } from "@/lib/tauri";
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

function commitTitle(message: string): string {
  const firstLine = message.split("\n", 1)[0]?.trim() ?? "";
  return firstLine || "Untitled commit";
}

export function GitHistoryPanel() {
  const open = useSettingsStore((s) => s.versioningOpen && s.versioningTab === "git");
  const closeVersioning = useSettingsStore((s) => s.closeVersioning);
  const projectId = useFilesStore((s) => s.projectId);
  const restoreFromGit = useFilesStore((s) => s.restoreFromGit);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmOid, setConfirmOid] = useState<string | null>(null);
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
    setBusy(false);
    setConfirmOid(null);
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

  return (
    <div className="min-h-0 flex-1 overflow-auto p-2">
      {visibleCommits.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No Git history yet. Initialize Source Control, then commit when you want a version here.
        </p>
      ) : (
        <div className="relative py-1">
          {visibleCommits.length > 1 ? (
            <span
              data-testid="history-graph-rail"
              aria-hidden
              className="absolute bottom-6 left-[18px] top-6 w-px bg-primary/40"
            />
          ) : null}
          {visibleCommits.map((c) => (
            <div
              key={c.oid}
              data-testid="history-commit"
              data-oid={c.oid}
              className="group relative flex items-start gap-3 rounded-md py-3 pl-10 pr-2 hover:bg-accent/60"
            >
              <span
                aria-hidden
                className="absolute left-[14px] top-[18px] z-10 size-2.5 rounded-full border-2 border-popover bg-primary ring-1 ring-primary/35"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    data-testid="history-commit-title"
                    className="truncate text-sm font-medium"
                  >
                    {commitTitle(c.message)}
                  </span>
                  <Tooltip
                    label={copiedOid === c.oid ? "Commit ID copied" : "Copy full commit ID"}
                    side="top"
                  >
                    <button
                      type="button"
                      aria-label={`Copy commit ID ${c.short}`}
                      onClick={() => void copyCommitId(c)}
                      className="inline-flex shrink-0 items-center gap-1 rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-foreground/80 hover:border-primary/40 hover:bg-accent hover:text-foreground"
                    >
                      {c.short}
                      {copiedOid === c.oid ? (
                        <Check className="size-2.5 text-emerald-500" />
                      ) : (
                        <Copy className="size-2.5 opacity-60" />
                      )}
                    </button>
                  </Tooltip>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {new Date(c.time * 1000).toLocaleString()}
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
      )}
    </div>
  );
}
