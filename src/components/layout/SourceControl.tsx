import { useCallback, useEffect, useState } from "react";
import {
  Check,
  FileText,
  GitBranch,
  Github,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { useFilesStore } from "@/store/files";
import { useDiffStore } from "@/store/diff";
import {
  gitAheadBehind,
  gitCommit,
  gitCurrentBranch,
  gitDiscard,
  gitGetRemote,
  gitPull,
  gitPush,
  gitRemoveRemote,
  gitStage,
  gitStageAll,
  gitStatus,
  gitUnstage,
  gitUnstageAll,
  getConfig,
  type AheadBehind,
  type GitFileChange,
} from "@/lib/tauri";
import { useSettingsStore } from "@/store/settings";
import { useGitStatusStore } from "@/store/git-status";
import { useGithubStore } from "@/store/github";
import { Tooltip } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { PublishToGitHubDialog } from "@/components/integrations/PublishToGitHubDialog";
import { cn } from "@/lib/utils";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  M: { label: "M", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  A: { label: "A", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  D: { label: "D", cls: "bg-destructive/15 text-destructive" },
  R: { label: "R", cls: "bg-primary/15 text-primary dark:text-primary" },
  "?": { label: "U", cls: "bg-primary/15 text-primary dark:text-primary" },
};

function meta(code: string) {
  return STATUS_META[code] ?? { label: code.slice(0, 1), cls: "bg-muted text-muted-foreground" };
}


export function SourceControl() {
  const projectId = useFilesStore((s) => s.projectId);
  const projectName = useFilesStore((s) => s.projectName);
  const refreshTree = useFilesStore((s) => s.refreshTree);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const setSettingsInitialSection = useSettingsStore((s) => s.setSettingsInitialSection);
  const ghStatus = useGithubStore((s) => s.status);
  const connected = ghStatus === "connected";

  useEffect(() => {
    if (ghStatus === "unknown") void useGithubStore.getState().refresh();
  }, [ghStatus]);

  const [changes, setChanges] = useState<GitFileChange[]>([]);
  const [branch, setBranch] = useState("");
  const [remote, setRemote] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [aheadBehind, setAheadBehind] = useState<AheadBehind | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);
  const openDiff = useDiffStore((s) => s.openDiff);
  const clearActiveDiff = useDiffStore((s) => s.clearActiveDiff);
  const openFile = useFilesStore((s) => s.openFile);

  // Open the file in the normal editor (VS Code's "Open File" SCM action).
  const openSourceFile = (path: string) => {
    void openFile(path);
    clearActiveDiff();
  };

  const refresh = useCallback(async () => {
    if (!projectId) return;
    try {
      const [chg, br, rem, cfg, ab] = await Promise.all([
        gitStatus(projectId),
        gitCurrentBranch(projectId).catch(() => ""),
        gitGetRemote(projectId).catch(() => null),
        getConfig(),
        gitAheadBehind(projectId).catch(() => null),
      ]);
      setChanges(chg);
      setBranch(br);
      setRemote(rem);
      setHasToken(!!cfg.github_connected);
      setAheadBehind(ab);
      void useGitStatusStore.getState().refresh(projectId);
    } catch {
      /* ignore */
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
    // Refresh when an editable diff (or other action) mutates the working tree.
    const onChanged = () => void refresh();
    window.addEventListener("openleaf:git-changed", onChanged);
    return () => window.removeEventListener("openleaf:git-changed", onChanged);
  }, [refresh]);

  const pull = async () => {
    if (!projectId) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await gitPull(projectId);
      setStatus({ ok: true, text: res });
      await refresh();
      await refreshTree();
    } catch (e) {
      setStatus({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      await gitRemoveRemote(projectId);
      setRemote(null);
      setAheadBehind(null);
      await refresh();
      setStatus({ ok: true, text: "Unlinked from GitHub." });
    } catch (e) {
      setStatus({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const viewDiff = (path: string, staged: boolean) => {
    openDiff(path, staged ? "staged" : "working");
  };

  const discard = async (path: string) => {
    if (!projectId) return;
    try {
      await gitDiscard(projectId, path);
      await refresh();
      await refreshTree();
      notifyGitChanged();
    } catch (e) {
      setStatus({ ok: false, text: String(e) });
    }
  };

  const notifyGitChanged = () =>
    window.dispatchEvent(new CustomEvent("openleaf:git-changed"));

  const runGit = async (op: () => Promise<unknown>) => {
    if (!projectId) return;
    try {
      await op();
      notifyGitChanged(); // the listener refreshes this panel; an open diff reloads too
    } catch (e) {
      setStatus({ ok: false, text: String(e) });
    }
  };
  const stageFile = (path: string) => runGit(() => gitStage(projectId!, path));
  const unstageFile = (path: string) => runGit(() => gitUnstage(projectId!, path));
  const stageAll = () => runGit(() => gitStageAll(projectId!));
  const unstageAll = () => runGit(() => gitUnstageAll(projectId!));

  const submit = async (andPush: boolean) => {
    if (!projectId) return;
    const msg = message.trim();
    const hasStaged = changes.some((c) => c.staged);
    // A commit requires staged files + a message; pushing existing commits does not.
    if (hasStaged && !msg) {
      setStatus({ ok: false, text: "Enter a commit message before committing." });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      // Commit the staged set only. Nothing staged -> no commit (push still runs).
      const committed = hasStaged ? await gitCommit(projectId, msg) : false;
      const parts: string[] = [committed ? `Committed: "${msg}"` : "Nothing staged to commit."];
      if (andPush) {
        if (!hasToken) {
          parts.push("⚠ Skipped push - no GitHub token (Settings → GitHub).");
        } else if (!remote) {
          parts.push("⚠ Skipped push - no remote origin set below.");
        } else {
          parts.push(await gitPush(projectId));
        }
      }
      setStatus({ ok: true, text: parts.join("\n") });
      setMessage("");
      await refresh();
      await refreshTree();
      notifyGitChanged();
      if (!andPush) window.setTimeout(() => setStatus(null), 1500);
    } catch (e) {
      setStatus({ ok: false, text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const staged = changes.filter((c) => c.staged);
  const unstaged = changes.filter((c) => !c.staged);

  const renderRow = (c: GitFileChange) => {
    const m = meta(c.status);
    const name = c.path.split("/").pop() ?? c.path;
    const dir = c.path.includes("/") ? c.path.slice(0, c.path.lastIndexOf("/")) : "";
    return (
      <div key={c.path} className="group flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-accent/60">
        <button
          onClick={() => void viewDiff(c.path, c.staged)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className={cn("flex size-4 shrink-0 items-center justify-center rounded text-[10px] font-semibold", m.cls)}>
            {m.label}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium">{name}</span>
            {dir && <span className="block truncate text-[10px] text-muted-foreground">{dir}</span>}
          </span>
        </button>
        <button
          onClick={() => openSourceFile(c.path)}
          aria-label="Open file"
          title="Open file"
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
        >
          <FileText className="size-3.5" />
        </button>
        {!c.staged &&
          (confirmDiscard === c.path ? (
            <>
              <button
                onClick={() => {
                  setConfirmDiscard(null);
                  void discard(c.path);
                }}
                aria-label="Confirm discard"
                title="Discard all changes to this file"
                className="flex size-6 shrink-0 items-center justify-center rounded text-destructive hover:bg-destructive/10"
              >
                <Check className="size-3.5" />
              </button>
              <button
                onClick={() => setConfirmDiscard(null)}
                aria-label="Cancel"
                className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmDiscard(c.path)}
              aria-label="Discard changes"
              title="Discard changes (revert to last version)"
              className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-destructive group-hover:opacity-100"
            >
              <Undo2 className="size-3.5" />
            </button>
          ))}
        <button
          onClick={() => void (c.staged ? unstageFile(c.path) : stageFile(c.path))}
          aria-label={c.staged ? "Unstage" : "Stage"}
          title={c.staged ? "Unstage" : "Stage"}
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
        >
          {c.staged ? <Minus className="size-3.5" /> : <Plus className="size-3.5" />}
        </button>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-sidebar-border px-3">
        <GitBranch className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium uppercase tracking-wide text-sidebar-foreground/70">Source Control</span>
        {branch ? (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
            <GitBranch className="size-3" />
            {branch}
          </span>
        ) : (
          <span className="ml-auto" />
        )}
        {remote && aheadBehind?.has_upstream && (aheadBehind.ahead > 0 || aheadBehind.behind > 0) && (
          <Tooltip
            label={`${aheadBehind.ahead} ahead · ${aheadBehind.behind} behind origin/${branch}`}
            side="bottom"
          >
            <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium">
              {aheadBehind.ahead > 0 && (
                <span className="text-emerald-600 dark:text-emerald-400">↑{aheadBehind.ahead}</span>
              )}
              {aheadBehind.behind > 0 && (
                <span className="text-amber-600 dark:text-amber-400">↓{aheadBehind.behind}</span>
              )}
            </span>
          </Tooltip>
        )}
        <Tooltip label="Refresh" side="bottom">
          <button
            onClick={() => void refresh()}
            aria-label="Refresh"
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </Tooltip>
      </div>

      {connected ? (
        <div className="min-h-0 flex-1 overflow-auto p-2">
        {changes.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">
            No changes. Working tree is clean.
          </p>
        ) : (
          <>
            {staged.length > 0 && (
              <div className="mb-2">
                <div className="group/hdr flex items-center gap-1.5 px-2 pb-1">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                    Staged
                  </span>
                  <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
                    {staged.length}
                  </span>
                  <button
                    onClick={() => void unstageAll()}
                    title="Unstage all"
                    aria-label="Unstage all"
                    className="ml-auto flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover/hdr:opacity-100"
                  >
                    <Minus className="size-3.5" />
                  </button>
                </div>
                {staged.map(renderRow)}
              </div>
            )}
            {unstaged.length > 0 && (
              <div className="group/hdr">
                <div className="flex items-center gap-1.5 px-2 pb-1">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                    Changes
                  </span>
                  <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
                    {unstaged.length}
                  </span>
                  <button
                    onClick={() => void stageAll()}
                    title="Stage all"
                    aria-label="Stage all"
                    className="ml-auto flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover/hdr:opacity-100"
                  >
                    <Plus className="size-3.5" />
                  </button>
                </div>
                {unstaged.map(renderRow)}
              </div>
            )}
          </>
        )}

        {/* Commit box */}
        <div className="mt-3 flex flex-col gap-2 border-t border-sidebar-border pt-3">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={2}
            placeholder="Commit message (required)…"
            className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-xs outline-none"
          />
          {staged.length === 0 && changes.length > 0 ? (
            <p className="-mt-1 text-[10px] text-muted-foreground">
              Stage a file to commit.
            </p>
          ) : (
            staged.length > 0 && !message.trim() && (
              <p className="-mt-1 text-[10px] text-muted-foreground">
                A commit message is required.
              </p>
            )
          )}
          <div className="flex gap-1.5">
            <button
              onClick={() => void submit(false)}
              disabled={busy || staged.length === 0 || !message.trim()}
              title={
                staged.length === 0
                  ? "Stage a file first"
                  : !message.trim()
                    ? "Enter a commit message"
                    : undefined
              }
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              Commit
            </button>
            <Tooltip label="Commit and push to origin" className="flex-1">
              <button
                onClick={() => void submit(true)}
                disabled={busy || !remote || (staged.length > 0 && !message.trim())}
                aria-label="Commit and push to origin"
                className="flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-40"
              >
                <Upload className="size-3.5" />
                Push
              </button>
            </Tooltip>
            <Tooltip label="Pull from origin" className="flex-1">
              <button
                onClick={() => void pull()}
                disabled={busy || !remote}
                aria-label="Pull from origin"
                className="flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-40"
              >
                <RefreshCw className="size-3.5" />
                Pull
              </button>
            </Tooltip>
          </div>
        </div>

        {status && (
          <div
            className={cn(
              "mt-2 whitespace-pre-wrap rounded-md border p-2 text-[11px]",
              status.ok
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "border-destructive/30 bg-destructive/10 text-destructive"
            )}
          >
            {status.text}
          </div>
        )}

        {/* Remote / origin */}
        <div className="mt-3 border-t border-sidebar-border pt-2">
          <div className="flex items-center justify-between gap-2 px-1 pb-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
              Remote
            </span>
            {remote && (
              <span className="truncate font-mono text-[10px] text-muted-foreground">{remote}</span>
            )}
          </div>
          {remote ? (
            <div className="flex gap-1.5 px-1">
              <button
                onClick={() => setPublishOpen(true)}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-accent disabled:opacity-40"
              >
                <Github className="size-3" /> Change repo
              </button>
              <button
                onClick={() => void unlink()}
                disabled={busy}
                className="rounded-md border px-2 py-1 text-[11px] hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
              >
                Unlink
              </button>
            </div>
          ) : (
            <div className="px-1">
              <button
                onClick={() => setPublishOpen(true)}
                disabled={busy}
                className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1.5 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
              >
                <Github className="size-3.5" /> Publish to GitHub
              </button>
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/70">
                Create a new repo or link an existing one as this project's remote, then push.
              </p>
            </div>
          )}
        </div>
      </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-foreground text-background">
            <Github className="size-6" />
          </span>
          <div className="space-y-1">
            <div className="text-sm font-medium">Connect GitHub to continue</div>
            <p className="mx-auto max-w-[18rem] text-xs text-muted-foreground">
              Back up your work, sync across devices, and keep full history. Commit, push, and
              pull live here once you&apos;re connected.
            </p>
          </div>
          <Button
            onClick={() => {
              setSettingsInitialSection("github");
              setSettingsOpen(true);
            }}
          >
            <Github className="size-4" />
            Connect to GitHub
          </Button>
          <button
            onClick={() => {
              setSettingsInitialSection("github");
              setSettingsOpen(true);
            }}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Use a personal access token instead
          </button>
        </div>
      )}

      <PublishToGitHubDialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        projectId={projectId}
        projectName={projectName}
        onPublished={(url) => {
          void refresh();
          setStatus({ ok: true, text: `Published to ${url}` });
        }}
      />
    </div>
  );
}
