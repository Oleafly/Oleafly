import { useCallback, useEffect, useState } from "react";
import {
  Columns2,
  GitBranch,
  Github,
  Loader2,
  Plus,
  RefreshCw,
  Rows3,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useFilesStore } from "@/store/files";
import {
  gitAheadBehind,
  gitAutoCommit,
  gitCurrentBranch,
  gitDiff,
  gitDiscard,
  gitGetRemote,
  gitPull,
  gitPush,
  gitRemoveRemote,
  gitStatus,
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

type DiffRow = {
  kind: "meta" | "hunk" | "context" | "del" | "add";
  text: string;
  oldLine?: number;
  newLine?: number;
};

function parseDiff(text: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  for (const raw of text.split("\n")) {
    if (raw.startsWith("@@")) {
      const m = raw.match(/@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
      if (m) {
        oldLine = +m[1];
        newLine = +m[2];
      }
      rows.push({ kind: "hunk", text: raw });
    } else if (
      raw.startsWith("diff ") ||
      raw.startsWith("index ") ||
      raw.startsWith("---") ||
      raw.startsWith("+++") ||
      raw.startsWith("\\")
    ) {
      rows.push({ kind: "meta", text: raw });
    } else if (raw.startsWith("-")) {
      rows.push({ kind: "del", text: raw.slice(1), oldLine: oldLine++ });
    } else if (raw.startsWith("+")) {
      rows.push({ kind: "add", text: raw.slice(1), newLine: newLine++ });
    } else {
      rows.push({
        kind: "context",
        text: raw.replace(/^ /, ""),
        oldLine: oldLine++,
        newLine: newLine++,
      });
    }
  }
  return rows;
}

function toSplitPairs(rows: DiffRow[]) {
  const out: { l?: DiffRow; r?: DiffRow }[] = [];
  let dels: DiffRow[] = [];
  let adds: DiffRow[] = [];
  const flush = () => {
    const max = Math.max(dels.length, adds.length);
    for (let k = 0; k < max; k++) out.push({ l: dels[k], r: adds[k] });
    dels = [];
    adds = [];
  };
  for (const r of rows) {
    if (r.kind === "context") {
      flush();
      out.push({ l: r, r: r });
    } else if (r.kind === "del") dels.push(r);
    else if (r.kind === "add") adds.push(r);
    else {
      flush();
      out.push({ l: r });
    }
  }
  flush();
  return out;
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
  const [diff, setDiff] = useState<{ path: string; text: string } | null>(null);
  const [diffBusy, setDiffBusy] = useState(false);
  const [split, setSplit] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);

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

  const viewDiff = async (path: string, staged: boolean) => {
    if (!projectId) return;
    setDiffBusy(true);
    try {
      const text = await gitDiff(projectId, path, staged);
      setDiff({ path, text: text || "(no textual changes)" });
    } catch (e) {
      setDiff({ path, text: String(e) });
    } finally {
      setDiffBusy(false);
    }
  };

  const discard = async (path: string) => {
    if (!projectId) return;
    try {
      await gitDiscard(projectId, path);
      await refresh();
      await refreshTree();
    } catch (e) {
      setStatus({ ok: false, text: String(e) });
    }
  };

  const submit = async (andPush: boolean) => {
    if (!projectId) return;
    const msg = message.trim();
    const hasChanges = changes.length > 0;
    // A commit requires a message; pushing already-made commits does not.
    if (hasChanges && !msg) {
      setStatus({ ok: false, text: "Enter a commit message before committing." });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const committed = hasChanges ? await gitAutoCommit(projectId, msg) : false;
      const parts: string[] = [committed ? `Committed: "${msg}"` : "No changes to commit."];
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
          onClick={() => void discard(c.path)}
          aria-label="Discard changes"
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-destructive group-hover:opacity-100"
        >
          <Trash2 className="size-3.5" />
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
                <div className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  Staged ({staged.length})
                </div>
                {staged.map(renderRow)}
              </div>
            )}
            <div>
              {staged.length > 0 && unstaged.length > 0 && (
                <div className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  Changes ({unstaged.length})
                </div>
              )}
              {unstaged.map(renderRow)}
            </div>
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
          {changes.length > 0 && !message.trim() && (
            <p className="-mt-1 text-[10px] text-muted-foreground">
              A commit message is required.
            </p>
          )}
          <div className="flex gap-1.5">
            <button
              onClick={() => void submit(false)}
              disabled={busy || changes.length === 0 || !message.trim()}
              title={changes.length > 0 && !message.trim() ? "Enter a commit message" : undefined}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              Commit
            </button>
            <Tooltip label="Commit and push to origin" className="flex-1">
              <button
                onClick={() => void submit(true)}
                disabled={busy || !remote || (changes.length > 0 && !message.trim())}
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

      {/* Diff viewer */}
      {diff && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={() => setDiff(null)}>
          <div className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-xl border bg-background shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{diff.path}</span>
              <div className="flex items-center rounded-md border p-0.5">
                <Tooltip label="Unified view">
                  <button
                    aria-label="Unified view"
                    onClick={() => setSplit(false)}
                    className={cn("flex size-6 items-center justify-center rounded", !split ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
                  >
                    <Rows3 className="size-3.5" />
                  </button>
                </Tooltip>
                <Tooltip label="Split view">
                  <button
                    aria-label="Split view"
                    onClick={() => setSplit(true)}
                    className={cn("flex size-6 items-center justify-center rounded", split ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
                  >
                    <Columns2 className="size-3.5" />
                  </button>
                </Tooltip>
              </div>
              <button onClick={() => setDiff(null)} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-background">
              {diffBusy ? (
                <div className="flex items-center justify-center p-6 text-xs text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" /> Loading diff…
                </div>
              ) : split ? (
                <div className="min-w-max bg-background font-mono text-[12px] leading-[1.6]">
                  {toSplitPairs(parseDiff(diff.text)).map((pair, i) => {
                    const l = pair.l;
                    const r = pair.r;
                    if (l && l.kind === "meta") return null;
                    if (l && l.kind === "hunk") {
                      return (
                        <div key={i} className="border-y border-border/60 bg-muted/40 px-3 py-0.5 text-[10px] text-muted-foreground">
                          {l.text}
                        </div>
                      );
                    }
                    const lDel = l?.kind === "del";
                    const rAdd = r?.kind === "add";
                    return (
                      <div key={i} className="grid grid-cols-[1rem_3rem_minmax(14rem,1fr)_1rem_3rem_minmax(14rem,1fr)] items-start border-b border-border/10">
                        <span className={cn("select-none text-center", lDel ? "bg-red-500/15 text-red-500" : "text-transparent")}>{lDel ? "-" : " "}</span>
                        <span className="select-none border-r border-border/40 bg-muted/20 pr-2 text-right text-muted-foreground/50">{l?.oldLine ?? ""}</span>
                        <span className={cn("whitespace-pre px-3", lDel ? "bg-red-500/10 text-foreground" : l ? "text-foreground" : "text-muted-foreground/30")}>{l ? l.text || " " : ""}</span>
                        <span className={cn("select-none text-center", rAdd ? "bg-emerald-500/15 text-emerald-500" : "text-transparent")}>{rAdd ? "+" : " "}</span>
                        <span className="select-none border-r border-border/40 bg-muted/20 pr-2 text-right text-muted-foreground/50">{r?.newLine ?? ""}</span>
                        <span className={cn("whitespace-pre px-3", rAdd ? "bg-emerald-500/10 text-foreground" : r ? "text-foreground" : "text-muted-foreground/30")}>{r ? r.text || " " : ""}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="min-w-max bg-background font-mono text-[12px] leading-[1.6]">
                  {parseDiff(diff.text).map((r, i) => {
                    if (r.kind === "meta") return null;
                    if (r.kind === "hunk") {
                      return (
                        <div key={i} className="border-y border-border/60 bg-muted/40 px-3 py-0.5 text-[10px] text-muted-foreground">
                          {r.text}
                        </div>
                      );
                    }
                    const del = r.kind === "del";
                    const add = r.kind === "add";
                    return (
                      <div
                        key={i}
                        className={cn(
                          "grid grid-cols-[1rem_3rem_3rem_1fr] items-start",
                          del && "bg-red-500/10",
                          add && "bg-emerald-500/10"
                        )}
                      >
                        <span className={cn("select-none text-center", del ? "text-red-500" : add ? "text-emerald-500" : "text-transparent")}>{del ? "-" : add ? "+" : " "}</span>
                        <span className="select-none border-r border-border/40 pr-2 text-right text-muted-foreground/50">{r.oldLine ?? ""}</span>
                        <span className="select-none border-r border-border/40 pr-2 text-right text-muted-foreground/50">{r.newLine ?? ""}</span>
                        <span className="whitespace-pre px-3 text-foreground">{r.text || " "}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
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
