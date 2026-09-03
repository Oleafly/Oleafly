import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  Check,
  FileText,
  GitBranch,
  Github,
  Info,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  ShieldAlert,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFilesStore } from "@/store/files";
import { useDiffStore } from "@/store/diff";
import {
  gitAheadBehind,
  gitCommit,
  gitCurrentBranch,
  gitGetRemote,
  gitCleanRemoteCredentials,
  gitInitialize,
  gitIsInitialized,
  gitPush,
  gitRemoveRemote,
  gitRemoteCredentialsNeedCleanup,
  gitStage,
  gitStageAll,
  gitStatus,
  gitUnstage,
  gitUnstageAll,
  getConfig,
  type AheadBehind,
  type GitFileChange,
} from "@/lib/tauri";
import { useGitStatusStore } from "@/store/git-status";
import { useGithubStore } from "@/store/github";
import { useSettingsStore } from "@/store/settings";
import { Tooltip } from "@/components/ui/tooltip";
import { PublishToGitHubDialog } from "@/components/integrations/PublishToGitHubDialog";
import { GithubMenu } from "@/components/layout/GithubMenu";
import { toGithubWebUrl } from "@/lib/github-url";
import { toast } from "@/lib/toast";
import { open } from "@tauri-apps/plugin-shell";
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

const COMMIT_TITLE_LIMIT = 72;

const REMOTE_HINT =
  "Create a new repo or link an existing one as this project's remote, then push.";

function composeCommitMessage(title: string, description: string): string {
  const subject = title.trim();
  const body = description.trim();
  return body ? `${subject}\n\n${body}` : subject;
}

type ProjectActionToken = {
  projectId: string;
  session: number;
};

export function SourceControl() {
  const projectId = useFilesStore((s) => s.projectId);
  const projectName = useFilesStore((s) => s.projectName);
  const refreshTree = useFilesStore((s) => s.refreshTree);
  const githubStatus = useGithubStore((s) => s.status);
  const githubUser = useGithubStore((s) => s.user);
  const githubConnected = githubStatus === "connected";
  const remoteFirst = githubStatus === "disconnected";

  const [changes, setChanges] = useState<GitFileChange[]>([]);
  const [initialized, setInitialized] = useState<boolean | null>(null);
  const [branch, setBranch] = useState("");
  const [remote, setRemote] = useState<string | null>(null);
  const [credentialCleanupRequired, setCredentialCleanupRequired] = useState(false);
  const githubUrl = remote ? toGithubWebUrl(remote) : null;
  const openInGithub = () => {
    if (githubUrl) void open(githubUrl);
  };
  const shareGithub = async () => {
    if (!githubUrl) return;
    try {
      await navigator.clipboard.writeText(githubUrl);
      toast.success("GitHub link copied");
    } catch {
      toast.info(githubUrl);
    }
  };
  const [hasToken, setHasToken] = useState(false);
  const [aheadBehind, setAheadBehind] = useState<AheadBehind | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);
  const previousProjectId = useRef(projectId);
  const refreshRequestId = useRef(0);
  const projectSession = useRef(0);
  const openDiff = useDiffStore((s) => s.openDiff);
  const clearActiveDiff = useDiffStore((s) => s.clearActiveDiff);
  const openFile = useFilesStore((s) => s.openFile);

  useLayoutEffect(() => {
    if (previousProjectId.current === projectId) return;
    previousProjectId.current = projectId;
    projectSession.current += 1;
    refreshRequestId.current += 1;
    setChanges([]);
    setInitialized(null);
    setBranch("");
    setRemote(null);
    setCredentialCleanupRequired(false);
    setAheadBehind(null);
    setTitle("");
    setDescription("");
    setBusy(false);
    setStatus(null);
    setPublishOpen(false);
    setConfirmDiscard(null);
  }, [projectId]);

  const beginProjectAction = (): ProjectActionToken | null => {
    if (!projectId || useFilesStore.getState().projectId !== projectId) return null;
    return { projectId, session: projectSession.current };
  };

  const isCurrentProjectAction = (action: ProjectActionToken) =>
    action.session === projectSession.current &&
    useFilesStore.getState().projectId === action.projectId;

  const openSourceFile = (path: string) => {
    void openFile(path);
    clearActiveDiff();
  };

  const refresh = useCallback(async () => {
    if (!projectId || useFilesStore.getState().projectId !== projectId) return;
    const targetProjectId = projectId;
    const requestId = ++refreshRequestId.current;
    try {
      const [repositoryInitialized, cfg] = await Promise.all([
        gitIsInitialized(targetProjectId),
        getConfig(),
      ]);
      if (
        requestId !== refreshRequestId.current ||
        useFilesStore.getState().projectId !== targetProjectId
      ) {
        return;
      }
      setInitialized(repositoryInitialized);
      setHasToken(!!cfg.github_connected);
      if (!repositoryInitialized) {
        setChanges([]);
        setBranch("");
        setRemote(null);
        setCredentialCleanupRequired(false);
        setAheadBehind(null);
        return;
      }
      const [chg, br, rem, ab, cleanupRequired] = await Promise.all([
        gitStatus(targetProjectId),
        gitCurrentBranch(targetProjectId).catch(() => ""),
        gitGetRemote(targetProjectId).catch(() => null),
        gitAheadBehind(targetProjectId).catch(() => null),
        gitRemoteCredentialsNeedCleanup(targetProjectId).catch(() => false),
      ]);
      if (
        requestId !== refreshRequestId.current ||
        useFilesStore.getState().projectId !== targetProjectId
      ) {
        return;
      }
      setChanges(chg);
      setBranch(br);
      setRemote(rem);
      setAheadBehind(ab);
      setCredentialCleanupRequired(cleanupRequired);
      void useGitStatusStore.getState().refresh(targetProjectId);
    } catch {
      /* ignore */
    }
  }, [projectId]);

  const initialize = async () => {
    const action = beginProjectAction();
    if (!action) return;
    setBusy(true);
    setStatus(null);
    try {
      const initializedBranch = await gitInitialize(action.projectId);
      if (!isCurrentProjectAction(action)) return;
      setStatus({ ok: true, text: `Initialized Git on ${initializedBranch}.` });
      await refresh();
    } catch (error) {
      if (!isCurrentProjectAction(action)) return;
      setStatus({ ok: false, text: String(error) });
    } finally {
      if (isCurrentProjectAction(action)) setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
    // Refresh when an editable diff (or other action) mutates the working tree.
    const onChanged = () => void refresh();
    window.addEventListener("oleafly:git-changed", onChanged);
    return () => window.removeEventListener("oleafly:git-changed", onChanged);
  }, [refresh]);

  const pull = async () => {
    const action = beginProjectAction();
    if (!action) return;
    setBusy(true);
    setStatus(null);
    try {
      const message = await useFilesStore.getState().pullFromGit(action.projectId);
      if (!isCurrentProjectAction(action)) return;
      setStatus({ ok: true, text: message });
      await refresh();
    } catch (e) {
      if (!isCurrentProjectAction(action)) return;
      setStatus({ ok: false, text: String(e) });
    } finally {
      if (isCurrentProjectAction(action)) setBusy(false);
    }
  };

  const unlink = async () => {
    const action = beginProjectAction();
    if (!action) return;
    setBusy(true);
    try {
      await gitRemoveRemote(action.projectId);
      if (!isCurrentProjectAction(action)) return;
      setRemote(null);
      setAheadBehind(null);
      await refresh();
      if (!isCurrentProjectAction(action)) return;
      setStatus({ ok: true, text: "Unlinked from GitHub." });
    } catch (e) {
      if (!isCurrentProjectAction(action)) return;
      setStatus({ ok: false, text: String(e) });
    } finally {
      if (isCurrentProjectAction(action)) setBusy(false);
    }
  };

  const cleanSavedCredential = async () => {
    const action = beginProjectAction();
    if (!action) return;
    setBusy(true);
    setStatus(null);
    try {
      await gitCleanRemoteCredentials(action.projectId);
      if (!isCurrentProjectAction(action)) return;
      setCredentialCleanupRequired(false);
      setStatus({ ok: true, text: "Removed the saved credential from this Git remote." });
      await refresh();
    } catch (error) {
      if (!isCurrentProjectAction(action)) return;
      setStatus({ ok: false, text: String(error) });
    } finally {
      if (isCurrentProjectAction(action)) setBusy(false);
    }
  };

  const viewDiff = (path: string, staged: boolean) => {
    openDiff(path, staged ? "staged" : "working");
  };

  const discard = async (path: string) => {
    const action = beginProjectAction();
    if (!action) return;
    try {
      await useFilesStore.getState().discardFromGit(action.projectId, path);
      if (!isCurrentProjectAction(action)) return;
      await refresh();
      if (!isCurrentProjectAction(action)) return;
      notifyGitChanged();
    } catch (e) {
      if (!isCurrentProjectAction(action)) return;
      setStatus({ ok: false, text: String(e) });
    }
  };

  const notifyGitChanged = () =>
    window.dispatchEvent(new CustomEvent("oleafly:git-changed"));

  const runGit = async (action: ProjectActionToken, op: () => Promise<unknown>) => {
    try {
      await op();
      if (!isCurrentProjectAction(action)) return;
      notifyGitChanged(); // the listener refreshes this panel; an open diff reloads too
    } catch (e) {
      if (!isCurrentProjectAction(action)) return;
      setStatus({ ok: false, text: String(e) });
    }
  };
  const stageFile = (path: string) => {
    const action = beginProjectAction();
    if (action) void runGit(action, () => gitStage(action.projectId, path));
  };
  const unstageFile = (path: string) => {
    const action = beginProjectAction();
    if (action) void runGit(action, () => gitUnstage(action.projectId, path));
  };
  const stageAll = () => {
    const action = beginProjectAction();
    if (action) void runGit(action, () => gitStageAll(action.projectId));
  };
  const unstageAll = () => {
    const action = beginProjectAction();
    if (action) void runGit(action, () => gitUnstageAll(action.projectId));
  };

  const submit = async (andPush: boolean) => {
    const action = beginProjectAction();
    if (!action) return;
    const subject = title.trim();
    const msg = composeCommitMessage(title, description);
    const hasStaged = changes.some((c) => c.staged);
    // A commit requires staged files + a message; pushing existing commits does not.
    if (hasStaged && !subject) {
      setStatus({ ok: false, text: "Enter a commit title before committing." });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      // Commit the staged set only. Nothing staged -> no commit (push still runs).
      const committed = hasStaged ? await gitCommit(action.projectId, msg) : false;
      if (!isCurrentProjectAction(action)) return;
      const parts: string[] = [
        committed ? `Committed: "${subject}"` : "Nothing staged to commit.",
      ];
      if (andPush) {
        if (!hasToken) {
          parts.push("⚠ Skipped push - no GitHub token (Settings → GitHub).");
        } else if (!remote) {
          parts.push("⚠ Skipped push - no remote origin set below.");
        } else {
          parts.push(await gitPush(action.projectId));
          if (!isCurrentProjectAction(action)) return;
        }
      }
      setStatus({ ok: true, text: parts.join("\n") });
      setTitle("");
      setDescription("");
      await refresh();
      if (!isCurrentProjectAction(action)) return;
      await refreshTree();
      if (!isCurrentProjectAction(action)) return;
      notifyGitChanged();
      if (!andPush) {
        window.setTimeout(() => {
          if (isCurrentProjectAction(action)) setStatus(null);
        }, 1500);
      }
    } catch (e) {
      if (!isCurrentProjectAction(action)) return;
      setStatus({ ok: false, text: String(e) });
    } finally {
      if (isCurrentProjectAction(action)) setBusy(false);
    }
  };

  const staged = changes.filter((c) => c.staged);
  const unstaged = changes.filter((c) => !c.staged);
  const canCommit = !busy && staged.length > 0 && title.trim().length > 0;

  const onTitleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!canCommit) return;
    void submit(false);
  };

  const openPublish = () => {
    if (!githubConnected) {
      const settings = useSettingsStore.getState();
      settings.setSettingsInitialSection("integrations");
      settings.setSettingsScrollTarget("github");
      settings.setSettingsOpen(true);
      return;
    }
    setPublishOpen(true);
  };

  const renderRow = (c: GitFileChange) => {
    const m = meta(c.status);
    const name = c.path.split("/").pop() ?? c.path;
    const dir = c.path.includes("/") ? c.path.slice(0, c.path.lastIndexOf("/")) : "";
    return (
      <div key={c.path} className="group flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-accent/60">
        <button type="button"
          data-testid={`git-change-${c.path}`}
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
        <button type="button"
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
              <button type="button"
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
              <button type="button"
                onClick={() => setConfirmDiscard(null)}
                aria-label="Cancel"
                className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </>
          ) : (
            <button type="button"
              onClick={() => setConfirmDiscard(c.path)}
              aria-label="Discard changes"
              title="Discard changes (revert to last version)"
              className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-destructive group-hover:opacity-100"
            >
              <Undo2 className="size-3.5" />
            </button>
          ))}
        <button type="button"
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

  const commitPanel = (
    <div className="flex flex-col gap-2">
      <Input
        data-testid="commit-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onTitleKeyDown}
        maxLength={COMMIT_TITLE_LIMIT}
        placeholder="Commit title"
        aria-label="Commit title"
        className="h-8 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs outline-none"
      />
      <Textarea
        data-testid="commit-description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder="Description (optional)"
        aria-label="Commit description"
        className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-xs outline-none"
      />
      {staged.length === 0 && changes.length > 0 ? (
        <p className="-mt-1 text-[10px] text-muted-foreground">Stage a file to commit.</p>
      ) : (
        staged.length > 0 &&
        !title.trim() && (
          <p className="-mt-1 text-[10px] text-muted-foreground">A commit title is required.</p>
        )
      )}
      <div className="flex gap-1.5">
        <button type="button"
          data-testid="commit-button"
          onClick={() => void submit(false)}
          disabled={busy || staged.length === 0 || !title.trim()}
          title={
            staged.length === 0
              ? "Stage a file first"
              : !title.trim()
                ? "Enter a commit title"
                : undefined
          }
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Commit
        </button>
        {githubConnected && (
          <>
            <Tooltip label="Commit and push to origin" className="flex-1">
              <button type="button"
                onClick={() => void submit(true)}
                disabled={busy || !remote || (staged.length > 0 && !title.trim())}
                aria-label="Commit and push to origin"
                className="flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-40"
              >
                <Upload className="size-3.5" />
                Push
              </button>
            </Tooltip>
            <Tooltip label="Pull from origin" className="flex-1">
              <button type="button"
                onClick={() => void pull()}
                disabled={busy || !remote}
                aria-label="Pull from origin"
                className="flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-40"
              >
                <RefreshCw className="size-3.5" />
                Pull
              </button>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );

  const statusNotice = status && (
    <div
      data-testid="source-control-status"
      className={cn(
        "mt-2 whitespace-pre-wrap break-words rounded-md border p-2 text-[11px]",
        status.ok
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : "border-destructive/30 bg-destructive/10 text-destructive"
      )}
    >
      {status.text}
    </div>
  );

  const remoteSection = (
    <div>
      <div className="flex items-center justify-between gap-2 px-1 pb-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Remote
          </span>
          <Tooltip wide side="top" label={REMOTE_HINT}>
            <Info
              role="img"
              aria-label={REMOTE_HINT}
              className="size-3.5 cursor-help text-muted-foreground hover:text-foreground"
            />
          </Tooltip>
        </span>
        {remote && (
          <span className="truncate font-mono text-[10px] text-muted-foreground">{remote}</span>
        )}
      </div>
      {remote ? (
        <div className="flex gap-1.5 px-1">
          <button type="button"
            onClick={openPublish}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-accent disabled:opacity-40"
          >
            <Github className="size-3" /> Change repo
          </button>
          <button type="button"
            onClick={() => void unlink()}
            disabled={busy}
            className="rounded-md border px-2 py-1 text-[11px] hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
          >
            Unlink
          </button>
        </div>
      ) : (
        <div className="px-1">
          <button type="button"
            onClick={openPublish}
            disabled={busy}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1.5 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            <Github className="size-3.5" /> Publish to GitHub
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-sidebar-border px-3">
        <GitBranch className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium uppercase tracking-wide text-sidebar-foreground/70">
          Source Control
        </span>
        <span className="ml-auto" />
        <Tooltip label="Refresh" side="bottom">
          <button type="button"
            onClick={() => void refresh()}
            aria-label="Refresh"
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </Tooltip>
        {branch && (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-medium text-white">
            <GitBranch className="size-3" />
            {branch}
          </span>
        )}
        {githubUrl && (
          <GithubMenu
            githubUrl={githubUrl}
            onOpenInGithub={openInGithub}
            onCopyLink={() => void shareGithub()}
          />
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
        {githubConnected && (
          <Tooltip
            side="bottom"
            wide
            label={
              <div className="flex items-center gap-2">
                {githubUser?.avatar_url ? (
                  <img
                    src={githubUser.avatar_url}
                    alt=""
                    className="size-9 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                    <Github className="size-4" />
                  </span>
                )}
                <div className="flex min-w-0 flex-col">
                  {githubUser?.name && (
                    <span className="truncate text-[13px] font-semibold text-foreground">
                      {githubUser.name}
                    </span>
                  )}
                  <span className="truncate text-xs text-muted-foreground">@{githubUser?.login}</span>
                </div>
              </div>
            }
          >
            {githubUser?.avatar_url ? (
              <img
                src={githubUser.avatar_url}
                alt={`@${githubUser.login}`}
                className="size-6 shrink-0 cursor-pointer rounded-full object-cover"
              />
            ) : (
              <span className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full bg-foreground text-background">
                <Github className="size-3.5" />
              </span>
            )}
          </Tooltip>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {credentialCleanupRequired && initialized === true && (
          <div className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p>Older Oleafly versions saved a credential in this Git remote.</p>
                <button
                  type="button"
                  onClick={() => void cleanSavedCredential()}
                  disabled={busy}
                  className="mt-1.5 rounded border border-current/30 px-2 py-1 font-medium hover:bg-amber-500/10 disabled:opacity-40"
                >
                  Remove saved credential
                </button>
              </div>
            </div>
          </div>
        )}
        {initialized === false ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
            <GitBranch className="size-8 text-muted-foreground/60" />
            <div>
              <p className="text-xs font-medium">Source Control is not initialized</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Oleafly will not commit to a Git repository automatically.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void initialize()}
              disabled={busy}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
            >
              Initialize Repository
            </button>
            <button
              type="button"
              onClick={openPublish}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-40"
            >
              <Github className="size-3.5" /> Publish to GitHub
            </button>
          </div>
        ) : initialized === null ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Checking Source Control…
          </div>
        ) : changes.length === 0 ? (
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
                  <button type="button"
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
                  <button type="button"
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
      </div>

      {initialized === true && (
        <div
          data-testid="source-control-actions"
          className="shrink-0 border-t border-sidebar-border bg-sidebar p-2"
        >
          {remoteFirst ? (
            <>
              {remoteSection}
              <div className="mt-3 border-t border-sidebar-border pt-2">{commitPanel}</div>
              {statusNotice}
            </>
          ) : (
            <>
              {commitPanel}
              {statusNotice}
              <div className="mt-3 border-t border-sidebar-border pt-2">{remoteSection}</div>
            </>
          )}
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
