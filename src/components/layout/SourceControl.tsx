import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
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
import { i18n } from "@/i18n";
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


function composeCommitMessage(title: string, description: string): string {
  const subject = title.trim();
  const body = description.trim();
  return body ? `${subject}\n\n${body}` : subject;
}

type ProjectActionToken = {
  projectId: string;
  session: number;
};

type PendingRefresh = ProjectActionToken & {
  queued: boolean;
  promise: Promise<void>;
};

export function SourceControl() {
  const { t } = useTranslation(["common", "shell"]);
  const remoteHint = t(($) => $.shell.sourceControl.remoteHint);
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
    if (githubUrl) open(githubUrl);
  };
  const shareGithub = async () => {
    if (!githubUrl) return;
    try {
      await navigator.clipboard.writeText(githubUrl);
      toast.success(i18n.t(($) => $.shell.sourceControl.linkCopied));
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
  const pendingRefresh = useRef<PendingRefresh | null>(null);
  const pendingMutation = useRef<ProjectActionToken | null>(null);
  const openDiff = useDiffStore((s) => s.openDiff);
  const clearActiveDiff = useDiffStore((s) => s.clearActiveDiff);
  const openFile = useFilesStore((s) => s.openFile);

  useLayoutEffect(() => {
    if (previousProjectId.current === projectId) return;
    previousProjectId.current = projectId;
    projectSession.current += 1;
    refreshRequestId.current += 1;
    pendingRefresh.current = null;
    pendingMutation.current = null;
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
    openFile(path);
    clearActiveDiff();
  };

  const refreshOnce = useCallback(async () => {
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
      useGitStatusStore.getState().refresh(targetProjectId);
    } catch {
      /* ignore */
    }
  }, [projectId]);

  // A slow Git process must not turn repeated refreshes into an unbounded
  // queue of readers ahead of a stage/commit waiting for the worktree lock.
  const refresh = useCallback(async () => {
    if (!projectId || useFilesStore.getState().projectId !== projectId) return;
    const current = pendingRefresh.current;
    if (current?.projectId === projectId && current.session === projectSession.current) {
      current.queued = true;
      refreshRequestId.current += 1;
      return current.promise;
    }
    const operation: PendingRefresh = {
      projectId,
      session: projectSession.current,
      queued: false,
      promise: Promise.resolve(),
    };
    pendingRefresh.current = operation;
    operation.promise = (async () => {
      do {
        operation.queued = false;
        await refreshOnce();
      } while (operation.queued && pendingRefresh.current === operation);
    })().finally(() => {
      if (pendingRefresh.current === operation) pendingRefresh.current = null;
    });
    return operation.promise;
  }, [projectId, refreshOnce]);

  const initialize = async () => {
    const action = beginProjectAction();
    if (!action) return;
    setBusy(true);
    setStatus(null);
    try {
      const initializedBranch = await gitInitialize(action.projectId);
      if (!isCurrentProjectAction(action)) return;
      setStatus({
        ok: true,
        text: t(($) => $.shell.sourceControl.initialized, { branch: initializedBranch }),
      });
      await refresh();
    } catch (error) {
      if (!isCurrentProjectAction(action)) return;
      setStatus({ ok: false, text: String(error) });
    } finally {
      if (isCurrentProjectAction(action)) setBusy(false);
    }
  };

  useEffect(() => {
    refresh();
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
      setStatus({ ok: true, text: t(($) => $.shell.sourceControl.unlinked) });
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
      setStatus({ ok: true, text: t(($) => $.shell.sourceControl.credentialRemoved) });
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
    if (busy || pendingMutation.current) return;
    pendingMutation.current = action;
    setBusy(true);
    try {
      await op();
      if (!isCurrentProjectAction(action)) return;
      notifyGitChanged(); // the listener refreshes this panel; an open diff reloads too
      await pendingRefresh.current?.promise;
    } catch (e) {
      if (!isCurrentProjectAction(action)) return;
      setStatus({ ok: false, text: String(e) });
    } finally {
      if (pendingMutation.current === action) {
        pendingMutation.current = null;
        if (isCurrentProjectAction(action)) setBusy(false);
      }
    }
  };
  const stageFile = (path: string) => {
    const action = beginProjectAction();
    if (action) runGit(action, () => gitStage(action.projectId, path));
  };
  const unstageFile = (path: string) => {
    const action = beginProjectAction();
    if (action) runGit(action, () => gitUnstage(action.projectId, path));
  };
  const stageAll = () => {
    const action = beginProjectAction();
    if (action) runGit(action, () => gitStageAll(action.projectId));
  };
  const unstageAll = () => {
    const action = beginProjectAction();
    if (action) runGit(action, () => gitUnstageAll(action.projectId));
  };

  const clearStatusLater = (action: ProjectActionToken) => {
    window.setTimeout(() => {
      if (isCurrentProjectAction(action)) setStatus(null);
    }, 1500);
  };

  const finishCommit = async (
    action: ProjectActionToken,
    andPush: boolean,
    parts: string[],
  ) => {
    setStatus({ ok: true, text: parts.join("\n") });
    setTitle("");
    setDescription("");
    await refresh();
    if (!isCurrentProjectAction(action)) return;
    await refreshTree();
    if (!isCurrentProjectAction(action)) return;
    notifyGitChanged();
    if (!andPush) clearStatusLater(action);
  };

  const appendPushResult = async (parts: string[], projectId: string) => {
    if (!hasToken) {
      parts.push(t(($) => $.shell.sourceControl.pushSkippedNoToken));
      return false;
    }
    if (!remote) {
      parts.push(t(($) => $.shell.sourceControl.pushSkippedNoRemote));
      return false;
    }
    parts.push(await gitPush(projectId));
    return true;
  };

  const submit = async (andPush: boolean) => {
    const action = beginProjectAction();
    if (!action) return;
    const subject = title.trim();
    const msg = composeCommitMessage(title, description);
    const hasStaged = changes.some((c) => c.staged);
    // A commit requires staged files + a message; pushing existing commits does not.
    if (hasStaged && !subject) {
      setStatus({ ok: false, text: t(($) => $.shell.sourceControl.titleRequiredStatus) });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      // Commit the staged set only. Nothing staged -> no commit (push still runs).
      const committed = hasStaged ? await gitCommit(action.projectId, msg) : false;
      if (!isCurrentProjectAction(action)) return;
      const parts: string[] = [
        committed
          ? t(($) => $.shell.sourceControl.committed, { subject })
          : t(($) => $.shell.sourceControl.nothingStaged),
      ];
      if (andPush) {
        const pushed = await appendPushResult(parts, action.projectId);
        if (pushed && !isCurrentProjectAction(action)) return;
      }
      await finishCommit(action, andPush, parts);
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
    submit(false);
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
          aria-label={t(($) => $.shell.sourceControl.openFile)}
          title={t(($) => $.shell.sourceControl.openFile)}
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
                  discard(c.path);
                }}
                aria-label={t(($) => $.shell.sourceControl.confirmDiscard)}
                title={t(($) => $.shell.sourceControl.confirmDiscardTitle)}
                className="flex size-6 shrink-0 items-center justify-center rounded text-destructive hover:bg-destructive/10"
              >
                <Check className="size-3.5" />
              </button>
              <button type="button"
                onClick={() => setConfirmDiscard(null)}
                aria-label={t(($) => $.common.actions.cancel)}
                className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </>
          ) : (
            <button type="button"
              onClick={() => setConfirmDiscard(c.path)}
              aria-label={t(($) => $.shell.sourceControl.discard)}
              title={t(($) => $.shell.sourceControl.discardTitle)}
              className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-destructive group-hover:opacity-100"
            >
              <Undo2 className="size-3.5" />
            </button>
          ))}
        <button type="button"
          onClick={() => void (c.staged ? unstageFile(c.path) : stageFile(c.path))}
          disabled={busy}
          aria-label={
            c.staged
              ? t(($) => $.shell.sourceControl.unstage)
              : t(($) => $.shell.sourceControl.stage)
          }
          title={
            c.staged
              ? t(($) => $.shell.sourceControl.unstage)
              : t(($) => $.shell.sourceControl.stage)
          }
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
        >
          {c.staged ? <Minus className="size-3.5" /> : <Plus className="size-3.5" />}
        </button>
      </div>
    );
  };

  const commitBlockedReason = () => {
    if (staged.length === 0) {
      return t(($) => $.shell.sourceControl.stageFirst);
    }
    if (!title.trim()) {
      return t(($) => $.shell.sourceControl.enterTitle);
    }
    return undefined;
  };

  const renderCommitPanel = () => (
    <div className="flex flex-col gap-2">
      <Input
        data-testid="commit-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onTitleKeyDown}
        maxLength={COMMIT_TITLE_LIMIT}
        placeholder={t(($) => $.shell.sourceControl.commitTitle)}
        aria-label={t(($) => $.shell.sourceControl.commitTitle)}
        className="h-8 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs outline-none"
      />
      <Textarea
        data-testid="commit-description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        placeholder={t(($) => $.shell.sourceControl.commitDescriptionPlaceholder)}
        aria-label={t(($) => $.shell.sourceControl.commitDescription)}
        className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-xs outline-none"
      />
      {staged.length === 0 && changes.length > 0 ? (
        <p className="-mt-1 text-[10px] text-muted-foreground">
          {t(($) => $.shell.sourceControl.stageToCommit)}
        </p>
      ) : (
        staged.length > 0 &&
        !title.trim() && (
          <p className="-mt-1 text-[10px] text-muted-foreground">
            {t(($) => $.shell.sourceControl.titleRequired)}
          </p>
        )
      )}
      <div className="flex gap-1.5">
        <button type="button"
          data-testid="commit-button"
          onClick={() => void submit(false)}
          disabled={busy || staged.length === 0 || !title.trim()}
          title={commitBlockedReason()}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          {t(($) => $.shell.sourceControl.commit)}
        </button>
        {githubConnected && (
          <>
            <Tooltip label={t(($) => $.shell.sourceControl.push)} className="flex-1">
              <button type="button"
                onClick={() => void submit(true)}
                disabled={busy || !remote || (staged.length > 0 && !title.trim())}
                aria-label={t(($) => $.shell.sourceControl.push)}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-40"
              >
                <Upload className="size-3.5" />
                {t(($) => $.shell.sourceControl.pushShort)}
              </button>
            </Tooltip>
            <Tooltip label={t(($) => $.shell.sourceControl.pull)} className="flex-1">
              <button type="button"
                onClick={() => void pull()}
                disabled={busy || !remote}
                aria-label={t(($) => $.shell.sourceControl.pull)}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-40"
              >
                <RefreshCw className="size-3.5" />
                {t(($) => $.shell.sourceControl.pullShort)}
              </button>
            </Tooltip>
          </>
        )}
      </div>
    </div>
  );

  const renderStatusNotice = () =>
    status && (
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

  const renderRemoteSection = () => (
    <div>
      <div className="flex items-center justify-between gap-2 px-1 pb-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            {t(($) => $.shell.sourceControl.remote)}
          </span>
          <Tooltip wide side="top" label={remoteHint}>
            <Info
              role="img"
              aria-label={remoteHint}
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
            <Github className="size-3" /> {t(($) => $.shell.sourceControl.changeRepo)}
          </button>
          <button type="button"
            onClick={() => void unlink()}
            disabled={busy}
            className="rounded-md border px-2 py-1 text-[11px] hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
          >
            {t(($) => $.shell.sourceControl.unlink)}
          </button>
        </div>
      ) : (
        <div className="px-1">
          <button type="button"
            onClick={openPublish}
            disabled={busy}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-2 py-1.5 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            <Github className="size-3.5" /> {t(($) => $.shell.sourceControl.publish)}
          </button>
        </div>
      )}
    </div>
  );

  const renderChangeList = () => {
    if (initialized === false) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
          <GitBranch className="size-8 text-muted-foreground/60" />
          <div>
            <p className="text-xs font-medium">
              {t(($) => $.shell.sourceControl.notInitialized)}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {t(($) => $.shell.sourceControl.notInitializedHint)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void initialize()}
            disabled={busy}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            {t(($) => $.shell.sourceControl.initialize)}
          </button>
          <button
            type="button"
            onClick={openPublish}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-40"
          >
            <Github className="size-3.5" /> {t(($) => $.shell.sourceControl.publish)}
          </button>
        </div>
      );
    }
    if (initialized === null) {
      return (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          {t(($) => $.shell.sourceControl.checking)}
        </div>
      );
    }
    if (changes.length === 0) {
      return (
        <p className="px-2 py-8 text-center text-xs text-muted-foreground">
          {t(($) => $.shell.sourceControl.clean)}
        </p>
      );
    }
    return (
      <>
        {staged.length > 0 && (
          <div className="mb-2">
            <div className="group/hdr flex items-center gap-1.5 px-2 pb-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                {t(($) => $.shell.sourceControl.staged)}
              </span>
              <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
                {staged.length}
              </span>
              <button type="button"
                onClick={() => void unstageAll()}
                disabled={busy}
                title={t(($) => $.shell.sourceControl.unstageAll)}
                aria-label={t(($) => $.shell.sourceControl.unstageAll)}
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
                {t(($) => $.shell.sourceControl.changes)}
              </span>
              <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
                {unstaged.length}
              </span>
              <button type="button"
                onClick={() => void stageAll()}
                disabled={busy}
                title={t(($) => $.shell.sourceControl.stageAll)}
                aria-label={t(($) => $.shell.sourceControl.stageAll)}
                className="ml-auto flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover/hdr:opacity-100"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
            {unstaged.map(renderRow)}
          </div>
        )}
      </>
    );
  };

  const renderAheadBehind = () => (
    remote && aheadBehind?.has_upstream && (aheadBehind.ahead > 0 || aheadBehind.behind > 0) && (
      <Tooltip
        label={t(($) => $.shell.sourceControl.aheadBehind, {
          ahead: aheadBehind.ahead,
          behind: aheadBehind.behind,
          branch,
        })}
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
    )
  );

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-sidebar-border px-3">
        <GitBranch className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium uppercase tracking-wide text-sidebar-foreground/70">
          {t(($) => $.shell.sourceControl.title)}
        </span>
        <span className="ml-auto" />
        <Tooltip label={t(($) => $.shell.sourceControl.refresh)} side="bottom">
          <button type="button"
            onClick={() => void refresh()}
            aria-label={t(($) => $.shell.sourceControl.refresh)}
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
        {renderAheadBehind()}
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
                  <span className="truncate text-xs text-muted-foreground">{`@${githubUser?.login}`}</span>
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
                <p>{t(($) => $.shell.sourceControl.credentialWarning)}</p>
                <button
                  type="button"
                  onClick={() => void cleanSavedCredential()}
                  disabled={busy}
                  className="mt-1.5 rounded border border-current/30 px-2 py-1 font-medium hover:bg-amber-500/10 disabled:opacity-40"
                >
                  {t(($) => $.shell.sourceControl.removeCredential)}
                </button>
              </div>
            </div>
          </div>
        )}
        {renderChangeList()}
      </div>

      {initialized === true && (
        <div
          data-testid="source-control-actions"
          className="shrink-0 border-t border-sidebar-border bg-sidebar p-2"
        >
          {remoteFirst ? (
            <>
              {renderRemoteSection()}
              <div className="mt-3 border-t border-sidebar-border pt-2">{renderCommitPanel()}</div>
              {renderStatusNotice()}
            </>
          ) : (
            <>
              {renderCommitPanel()}
              {renderStatusNotice()}
              <div className="mt-3 border-t border-sidebar-border pt-2">{renderRemoteSection()}</div>
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
          refresh();
          setStatus({
            ok: true,
            text: t(($) => $.shell.sourceControl.published, { url }),
          });
        }}
      />
    </div>
  );
}
