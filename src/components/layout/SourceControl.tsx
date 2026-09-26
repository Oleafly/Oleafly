import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import type {
  GitCommit,
  GitFileChange,
  GitPullResult,
  GitWorkspaceSnapshot,
  ProjectStateChanged,
} from "@oleafly/backend-port";
import {
  Archive,
  BookPlus,
  Check,
  ChevronDown,
  CloudDownload,
  Copy,
  Diff,
  FileSymlink,
  Files,
  Github,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import * as tauri from "@/lib/tauri";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { FileIcon } from "@/components/files/fileIcon";
import { useDiffStore } from "@/store/diff";
import { useFilesStore } from "@/store/files";
import { useGitStatusStore } from "@/store/git-status";
import { PublishToGitHubDialog } from "@/components/integrations/PublishToGitHubDialog";
import { GithubMenu } from "@/components/layout/GithubMenu";
import { SidebarSection } from "@/components/layout/SidebarSection";
import {
  consumeSourceControlGraphRequest,
  SOURCE_CONTROL_SHOW_GRAPH_EVENT,
} from "@/lib/source-control-events";
import { toGithubWebUrl } from "@/lib/github-url";
import { describeError } from "@/lib/app-error";
import { cn } from "@/lib/utils";
import { open } from "@tauri-apps/plugin-shell";

type GitGraphCommit = GitCommit;
type ProjectStateResult = { projectState: ProjectStateChanged };
type CommitSubmissionResult = {
  committed: true;
  remoteError?: unknown;
  conflicts?: boolean;
};
const COMMIT_TITLE_LIMIT = 72;
const STATUS_META: Record<string, { label: string; cls: string }> = {
  M: { label: "M", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  A: {
    label: "A",
    cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
  D: { label: "D", cls: "bg-destructive/15 text-destructive" },
  R: { label: "R", cls: "bg-primary/15 text-primary" },
  "?": { label: "U", cls: "bg-primary/15 text-primary" },
  U: { label: "!", cls: "bg-destructive/15 text-destructive" },
};
const statusMeta = (status: string) =>
  STATUS_META[status] ?? {
    label: status.slice(0, 1),
    cls: "bg-muted text-muted-foreground",
  };
const commitMessage = (title: string, description: string) =>
  description.trim()
    ? `${title.trim()}\n\n${description.trim()}`
    : title.trim();
type ActionToken = { projectId: string; session: number };
type PendingRefresh = ActionToken & { queued: boolean; promise: Promise<void> };
type Confirmation = {
  paths: string[];
  title: string;
  description: string;
  confirm: string;
} | null;

export function SourceControl() {
  const { t } = useTranslation(["common", "shell"]);
  const projectId = useFilesStore((s) => s.projectId);
  const projectName = useFilesStore((s) => s.projectName);
  const openFile = useFilesStore((s) => s.openFile);
  const refreshTree = useFilesStore((s) => s.refreshTree);
  const pullFromGit = useFilesStore((s) => s.pullFromGit);
  const restoreFromGit = useFilesStore((s) => s.restoreFromGit);
  const openDiff = useDiffStore((s) => s.openDiff);
  const clearActiveDiff = useDiffStore((s) => s.clearActiveDiff);
  const [snapshot, setSnapshot] = useState<GitWorkspaceSnapshot | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [publishOpen, setPublishOpen] = useState(false);
  const [credentialCleanupRequired, setCredentialCleanupRequired] =
    useState(false);
  const [discardConfirmation, setDiscardConfirmation] =
    useState<Confirmation>(null);
  const [sectionOpen, setSectionOpen] = useState({
    staged: true,
    changes: true,
    graph: true,
  });
  const [branchFormOpen, setBranchFormOpen] = useState(false);
  const [branchDraft, setBranchDraft] = useState("");
  const [abortMergeOpen, setAbortMergeOpen] = useState(false);
  const [restoreCommit, setRestoreCommit] = useState<GitGraphCommit | null>(
    null,
  );
  const [copiedOid, setCopiedOid] = useState<string | null>(null);
  const previousProjectId = useRef(projectId);
  const session = useRef(0);
  const refreshRequest = useRef(0);
  const pendingRefresh = useRef<PendingRefresh | null>(null);
  const activeMutation = useRef<ActionToken | null>(null);

  useLayoutEffect(() => {
    if (previousProjectId.current === projectId) return;
    previousProjectId.current = projectId;
    session.current += 1;
    refreshRequest.current += 1;
    pendingRefresh.current = null;
    activeMutation.current = null;
    setSnapshot(null);
    setTitle("");
    setDescription("");
    setBusy(false);
    setNotice(null);
    setCredentialCleanupRequired(false);
    setDiscardConfirmation(null);
    setBranchDraft("");
    setBranchFormOpen(false);
    setRestoreCommit(null);
    setAbortMergeOpen(false);
    setCopiedOid(null);
    setPublishOpen(false);
  }, [projectId]);
  const begin = useCallback(
    (): ActionToken | null =>
      !projectId || useFilesStore.getState().projectId !== projectId
        ? null
        : { projectId, session: session.current },
    [projectId],
  );
  const current = useCallback(
    (action: ActionToken) =>
      action.session === session.current &&
      useFilesStore.getState().projectId === action.projectId,
    [],
  );
  const refreshOnce = useCallback(async () => {
    if (!projectId || useFilesStore.getState().projectId !== projectId) return;
    const request = ++refreshRequest.current;
    try {
      const [next, needsCredentialCleanup] = await Promise.all([
        tauri.gitWorkspaceSnapshot(projectId),
        tauri.gitRemoteCredentialsNeedCleanup(projectId).catch(() => false),
      ]);
      if (
        request !== refreshRequest.current ||
        useFilesStore.getState().projectId !== projectId
      )
        return;
      setSnapshot(next);
      setCredentialCleanupRequired(next.initialized && needsCredentialCleanup);
      void useGitStatusStore.getState().refresh(projectId);
    } catch (error) {
      if (
        request === refreshRequest.current &&
        useFilesStore.getState().projectId === projectId
      )
        setNotice({ ok: false, text: String(error) });
    }
  }, [projectId]);
  const refresh = useCallback(async () => {
    if (!projectId || useFilesStore.getState().projectId !== projectId) return;
    const pending = pendingRefresh.current;
    if (
      pending?.projectId === projectId &&
      pending.session === session.current
    ) {
      pending.queued = true;
      refreshRequest.current += 1;
      return pending.promise;
    }
    const operation: PendingRefresh = {
      projectId,
      session: session.current,
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
  useEffect(() => {
    void refresh();
    const changed = () => void refresh();
    window.addEventListener("oleafly:git-changed", changed);
    return () => window.removeEventListener("oleafly:git-changed", changed);
  }, [refresh]);
  useEffect(() => {
    const showGraph = () => {
      consumeSourceControlGraphRequest();
      setSectionOpen((value) => ({ ...value, graph: true }));
    };
    if (consumeSourceControlGraphRequest()) showGraph();
    window.addEventListener(SOURCE_CONTROL_SHOW_GRAPH_EVENT, showGraph);
    return () =>
      window.removeEventListener(SOURCE_CONTROL_SHOW_GRAPH_EVENT, showGraph);
  }, []);
  const mutate = useCallback(
    async <T,>(
      action: ActionToken,
      operation: () => Promise<T>,
    ): Promise<T | undefined> => {
      if (busy || activeMutation.current) return;
      activeMutation.current = action;
      setBusy(true);
      setNotice(null);
      try {
        const result = await operation();
        if (current(action)) {
          window.dispatchEvent(new CustomEvent("oleafly:git-changed"));
          await pendingRefresh.current?.promise;
        }
        return result;
      } catch (error) {
        if (current(action)) setNotice({ ok: false, text: describeError(error) });
        return undefined;
      } finally {
        if (activeMutation.current === action) {
          activeMutation.current = null;
          if (current(action)) setBusy(false);
        }
      }
    },
    [busy, current],
  );
  const external = useCallback(
    (
      action: ActionToken,
      operation: (generation: number) => Promise<unknown>,
    ) =>
      mutate(action, () =>
        useFilesStore
          .getState()
          .runExternalProjectMutation(action.projectId, async (generation) => {
            const result = await operation(generation);
            return typeof result === "object" &&
              result !== null &&
              "projectState" in result
              ? (result as ProjectStateResult)
              : ({ projectState: result } as ProjectStateResult);
          }),
      ),
    [mutate],
  );
  const staged = useMemo(
    () =>
      snapshot?.changes.filter((change) => change.staged && !change.conflict) ??
      [],
    [snapshot],
  );
  const changes = useMemo(
    () =>
      snapshot?.changes.filter(
        (change) => !change.staged && !change.conflict,
      ) ?? [],
    [snapshot],
  );
  const conflicts = snapshot?.conflicts ?? [];
  const branch = snapshot?.branch ?? "";
  const remote = snapshot?.remote ?? null;
  const commitFlowReady =
    snapshot?.operation === "idle" && conflicts.length === 0;
  const canCommit =
    !busy && commitFlowReady && staged.length > 0 && title.trim().length > 0;
  const canAmend =
    !busy &&
    commitFlowReady &&
    (snapshot?.commits.length ?? 0) > 0 &&
    (title.trim().length > 0 || description.trim().length === 0);
  const commitBlocker = (() => {
    if (busy) return null;
    if (conflicts.length > 0) {
      return t(($) => $.shell.sourceControl.mergeNeedsAttention);
    }
    if (!commitFlowReady) {
      return t(($) => $.shell.sourceControl.finishMergeToCommit);
    }
    if (staged.length === 0) {
      return changes.length > 0
        ? t(($) => $.shell.sourceControl.stageToCommit)
        : t(($) => $.shell.sourceControl.nothingStaged);
    }
    if (title.trim().length === 0) {
      return t(($) => $.shell.sourceControl.titleRequiredStatus);
    }
    return null;
  })();
  const openSourceFile = async (path: string) => {
    try {
      await openFile(path);
      clearActiveDiff();
    } catch (error) {
      setNotice({ ok: false, text: String(error) });
    }
  };
  const openChange = (change: GitFileChange) =>
    openDiff(change.path, change.staged ? "staged" : "working");
  const openAll = (entries: GitFileChange[]) => entries.forEach(openChange);
  const stagePaths = (paths: string[]) => {
    const action = begin();
    if (action)
      void mutate(action, () => tauri.gitStagePaths(action.projectId, paths));
  };
  const unstagePaths = (paths: string[]) => {
    const action = begin();
    if (action)
      void mutate(action, () => tauri.gitUnstagePaths(action.projectId, paths));
  };
  const requestDiscard = (paths: string[]) => {
    if (paths.length)
      setDiscardConfirmation({
        paths,
        title: t(($) => $.shell.sourceControl.discardChangesTitle),
        description: t(($) => $.shell.sourceControl.discardChangesDescription, {
          count: paths.length,
        }),
        confirm: t(($) =>
          paths.length === 1
            ? $.shell.sourceControl.discard
            : $.shell.sourceControl.discardAll,
        ),
      });
  };
  const confirmDiscard = () => {
    const confirmation = discardConfirmation;
    const action = begin();
    if (!confirmation || !action) return;
    setDiscardConfirmation(null);
    void external(action, (generation) =>
      tauri.gitDiscardPaths(action.projectId, confirmation.paths, generation),
    );
  };
  const submit = async (kind: "commit" | "amend" | "push" | "sync") => {
    const action = begin();
    if (!action || (kind === "amend" ? !canAmend : !canCommit)) return;
    const subject = title.trim();
    const text =
      kind === "amend" && !subject ? "" : commitMessage(title, description);
    const result = await mutate<CommitSubmissionResult>(action, async () => {
      const committed =
        kind === "amend"
          ? await tauri.gitCommitAmend(action.projectId, text)
          : await tauri.gitCommit(action.projectId, text);
      if (!committed)
        throw new Error(t(($) => $.shell.sourceControl.nothingStaged));
      try {
        if (kind === "sync") {
          const pullResult = await pullFromGit(action.projectId);
          if (pullResult.conflicts.length)
            return { committed: true, conflicts: true };
          await tauri.gitPush(action.projectId);
        }
        if (kind === "push") await tauri.gitPush(action.projectId);
      } catch (remoteError) {
        return { committed: true, remoteError };
      }
      return { committed: true };
    });
    if (result?.committed && current(action)) {
      setTitle("");
      setDescription("");
      if (result.remoteError) {
        setNotice({
          ok: false,
          text: t(($) => $.shell.sourceControl.committedRemoteFailed, {
            step:
              kind === "sync"
                ? t(($) => $.shell.sourceControl.sync).toLocaleLowerCase()
                : t(($) => $.shell.sourceControl.pushShort).toLocaleLowerCase(),
            reason: String(result.remoteError),
          }),
        });
      } else if (result.conflicts) {
        setNotice({
          ok: false,
          text: t(($) => $.shell.sourceControl.committedWithConflicts),
        });
      } else {
        setNotice({
          ok: true,
          text: subject
            ? t(($) => $.shell.sourceControl.committed, { subject })
            : t(($) => $.shell.sourceControl.amendedKeptMessage),
        });
      }
      await refreshTree();
    }
  };
  const action = (operation: (token: ActionToken) => Promise<unknown>) => {
    const token = begin();
    if (token) void mutate(token, () => operation(token));
  };
  const externalAction = (
    operation: (token: ActionToken, generation: number) => Promise<unknown>,
  ) => {
    const token = begin();
    if (token)
      void external(token, (generation) => operation(token, generation));
  };
  const report = (token: ActionToken, result: unknown) => {
    if (!current(token)) return;
    if (typeof result === "string") {
      if (result) setNotice({ ok: true, text: result });
      return;
    }
    if (typeof result !== "object" || result === null) return;
    const { message, conflicts, outcome } = result as {
      message?: unknown;
      conflicts?: unknown;
      outcome?: unknown;
    };
    if (typeof message !== "string" || !message) return;
    setNotice({
      ok: outcome !== "failed" && !(Array.isArray(conflicts) && conflicts.length > 0),
      text: message,
    });
  };
  const copyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setNotice({
        ok: true,
        text: t(($) => $.shell.sourceControl.linkCopied),
      });
    } catch (error) {
      setNotice({ ok: false, text: String(error) });
    }
  };
  const unlinkRemote = () =>
    action(async (token) => {
      await tauri.gitRemoveRemote(token.projectId);
      if (current(token)) {
        setNotice({ ok: true, text: t(($) => $.shell.sourceControl.unlinked) });
      }
    });
  const cleanSavedCredential = () =>
    action(async (token) => {
      await tauri.gitCleanRemoteCredentials(token.projectId);
      if (current(token)) {
        setCredentialCleanupRequired(false);
        setNotice({
          ok: true,
          text: t(($) => $.shell.sourceControl.credentialRemoved),
        });
      }
    });
  const createBranch = async () => {
    const name = branchDraft.trim();
    const token = begin();
    if (!name || !token) return;
    const created = await mutate(token, () =>
      tauri.gitCreateBranch(token.projectId, name),
    );
    if (created && current(token)) {
      setBranchDraft("");
      setBranchFormOpen(false);
    }
  };
  const sync = () =>
    action(async (token) => {
      const result: GitPullResult = await pullFromGit(token.projectId);
      if (result.conflicts.length) {
        report(token, result);
        return result;
      }
      const pushed = await tauri.gitPush(token.projectId);
      report(token, pushed);
      return pushed;
    });
  const copyCommitId = async (commit: GitGraphCommit) => {
    try {
      await navigator.clipboard.writeText(commit.oid);
      setCopiedOid(commit.oid);
      window.setTimeout(
        () => setCopiedOid((value) => (value === commit.oid ? null : value)),
        1500,
      );
    } catch (error) {
      setNotice({ ok: false, text: String(error) });
    }
  };
  const restoreGraphCommit = async () => {
    const commit = restoreCommit;
    const token = begin();
    if (!commit || !token) return;
    setRestoreCommit(null);
    await mutate(token, () => restoreFromGit(token.projectId, commit.oid));
    if (current(token)) await refreshTree();
  };
  const row = (change: GitFileChange) => {
    const info = statusMeta(change.status);
    const name = change.path.split("/").pop() ?? change.path;
    const openLabel = t(($) => $.shell.sourceControl.openFileFor, {
      path: change.path,
    });
    const discardLabel = t(($) => $.shell.sourceControl.discardFor, {
      path: change.path,
    });
    const stageLabel = t(
      change.staged
        ? ($) => $.shell.sourceControl.unstageFor
        : ($) => $.shell.sourceControl.stageFor,
      { path: change.path },
    );
    const statusId = `git-status-${change.staged ? "staged" : "working"}-${encodeURIComponent(change.path)}`;
    const directory = change.path.includes("/")
      ? change.path.slice(0, change.path.lastIndexOf("/"))
      : "";
    return (
      <div
        key={`${change.staged ? "staged" : "change"}:${change.path}`}
        className="group flex w-full items-center gap-1 py-1 pl-4 pr-2 hover:bg-accent/60 focus-within:bg-accent/60"
      >
        <button
          type="button"
          data-testid={`git-change-${change.path}`}
          aria-describedby={statusId}
          onClick={() => openChange(change)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <FileIcon name={name} className="size-4 shrink-0" />
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium">{name}</span>
            {directory ? (
              <span className="block truncate text-[10px] text-muted-foreground">
                {directory}
              </span>
            ) : null}
          </span>
        </button>
        <Tooltip label={t(($) => $.shell.sourceControl.openFile)}>
          <button
            type="button"
            aria-label={openLabel}
            onClick={() => void openSourceFile(change.path)}
            className="flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-accent hover:text-foreground"
          >
            <FileSymlink className="size-3.5" />
          </button>
        </Tooltip>
        {!change.staged ? (
          <Tooltip label={t(($) => $.shell.sourceControl.discard)}>
            <button
              type="button"
              aria-label={discardLabel}
              disabled={busy}
              onClick={() => requestDiscard([change.path])}
              className="flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-destructive/10 hover:text-destructive"
            >
              <Undo2 className="size-3.5" />
            </button>
          </Tooltip>
        ) : null}
        <Tooltip
          label={
            change.staged
              ? t(($) => $.shell.sourceControl.unstage)
              : t(($) => $.shell.sourceControl.stage)
          }
        >
          <button
            type="button"
            aria-label={stageLabel}
            disabled={busy}
            onClick={() =>
              change.staged
                ? unstagePaths([change.path])
                : stagePaths([change.path])
            }
            className="flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-accent hover:text-foreground"
          >
            {change.staged ? (
              <RotateCcw className="size-3.5" />
            ) : (
              <Plus className="size-3.5" />
            )}
          </button>
        </Tooltip>
        <span
          id={statusId}
          data-testid={`git-status-${change.staged ? "staged" : "working"}-${change.path}`}
          className={cn(
            "ml-1 flex size-4 shrink-0 items-center justify-center rounded text-[10px] font-semibold",
            info.cls,
          )}
        >
          {info.label}
        </span>
      </div>
    );
  };
  const sectionActions = (kind: "staged" | "changes") => {
    const entries = kind === "staged" ? staged : changes;
    const paths = entries.map((entry) => entry.path);
    const actionClass =
      "flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground";
    return (
      <>
        <Tooltip label={t(($) => $.shell.sourceControl.openAllChanges)}>
          <button
            type="button"
            aria-label={t(($) => $.shell.sourceControl.openAllChanges)}
            className={actionClass}
            disabled={!entries.length}
            onClick={() => openAll(entries)}
          >
            <Files aria-hidden className="size-3.5" />
          </button>
        </Tooltip>
        {kind === "changes" ? (
          <>
            <Tooltip label={t(($) => $.shell.sourceControl.discardAll)}>
              <button
                type="button"
                aria-label={t(($) => $.shell.sourceControl.discardAll)}
                className={cn(
                  actionClass,
                  "hover:bg-destructive/10 hover:text-destructive",
                )}
                disabled={!entries.length || busy}
                onClick={() => requestDiscard(paths)}
              >
                <Undo2 aria-hidden className="size-3.5" />
              </button>
            </Tooltip>
            <Tooltip label={t(($) => $.shell.sourceControl.stageAll)}>
              <button
                type="button"
                aria-label={t(($) => $.shell.sourceControl.stageAll)}
                className={actionClass}
                disabled={!entries.length || busy}
                onClick={() => stagePaths(paths)}
              >
                <Plus aria-hidden className="size-3.5" />
              </button>
            </Tooltip>
          </>
        ) : (
          <Tooltip label={t(($) => $.shell.sourceControl.unstageAll)}>
            <button
              type="button"
              aria-label={t(($) => $.shell.sourceControl.unstageAll)}
              className={actionClass}
              disabled={!entries.length || busy}
              onClick={() => unstagePaths(paths)}
            >
              <RotateCcw aria-hidden className="size-3.5" />
            </button>
          </Tooltip>
        )}
      </>
    );
  };
  const onCommitKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit("commit");
    }
  };
  if (!projectId || snapshot === null)
    return (
      <div className="flex h-full flex-col bg-sidebar">
        <Header branch="" remote={null} busy={busy} onRefresh={refresh} />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 text-center">
          {projectId && !notice ? (
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          ) : (
            <GitBranch className="size-6 text-muted-foreground/60" />
          )}
          <p
            role={notice?.ok === false ? "alert" : undefined}
            className={cn(
              "text-xs text-muted-foreground",
              notice?.ok === false && "text-destructive",
            )}
          >
            {notice?.text ??
              (projectId
                ? t(($) => $.shell.sourceControl.checking)
                : t(($) => $.shell.sourceControl.noProject))}
          </p>
        </div>
      </div>
    );
  if (snapshot?.initialized === false)
    return (
      <div className="flex h-full flex-col bg-sidebar">
        <Header
          branch=""
          remote={null}
          busy={busy}
          onRefresh={refresh}
          onPublish={() => setPublishOpen(true)}
        />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 text-center">
          <GitBranch className="size-8 text-muted-foreground/60" />
          <div>
            <p className="text-xs font-medium">
              {t(($) => $.shell.sourceControl.notInitialized)}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t(($) => $.shell.sourceControl.notInitializedHint)}
            </p>
          </div>
          <Button
            size="sm"
            onClick={() =>
              action((token) => tauri.gitInitialize(token.projectId))
            }
            disabled={busy}
          >
            {t(($) => $.shell.sourceControl.initialize)}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPublishOpen(true)}
          >
            {t(($) => $.shell.sourceControl.publish)}
          </Button>
          {notice ? (
            <p
              role={notice.ok ? undefined : "alert"}
              className={cn(
                "text-[11px]",
                notice.ok ? "text-muted-foreground" : "text-destructive",
              )}
            >
              {notice.text}
            </p>
          ) : null}
        </div>
        <PublishToGitHubDialog
          open={publishOpen}
          onClose={() => setPublishOpen(false)}
          projectId={projectId}
          projectName={projectName}
          onPublished={() => {
            void refresh();
          }}
        />
      </div>
    );
  return (
    <div className="flex h-full flex-col bg-sidebar">
      <Header
        branch={branch}
        remote={remote}
        aheadBehind={snapshot?.aheadBehind}
        busy={busy}
        onRefresh={refresh}
        onFetch={() =>
          action(async (token) =>
            report(token, await tauri.gitFetch(token.projectId)),
          )
        }
        onPull={() =>
          action(async (token) =>
            report(token, await pullFromGit(token.projectId)),
          )
        }
        onPush={() =>
          action(async (token) =>
            report(token, await tauri.gitPush(token.projectId)),
          )
        }
        onSync={sync}
        onStash={(pop) =>
          externalAction(async (token, generation) => {
            const result = pop
              ? await tauri.gitStashPop(token.projectId, generation)
              : await tauri.gitStashPush(token.projectId, generation);
            report(token, result);
            return result;
          })
        }
        onCopyLink={(link) => void copyLink(link)}
        branches={snapshot?.branches ?? []}
        onCheckout={(target) =>
          externalAction((token, generation) =>
            tauri.gitCheckoutBranch(token.projectId, target, generation),
          )
        }
        branchFormOpen={branchFormOpen}
        onBranchFormOpen={setBranchFormOpen}
        branchDraft={branchDraft}
        onBranchDraft={setBranchDraft}
        onCreateBranch={() => void createBranch()}
        onPublish={() => setPublishOpen(true)}
        onUnlink={unlinkRemote}
      />
      {credentialCleanupRequired ? (
        <div className="mx-2 mt-2 rounded-md border border-amber-500/35 bg-amber-500/10 p-2 text-[11px] text-amber-800 dark:text-amber-200">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
            <div>
              <p>{t(($) => $.shell.sourceControl.credentialWarning)}</p>
              <Button
                variant="outline"
                size="xs"
                className="mt-1.5"
                disabled={busy}
                onClick={cleanSavedCredential}
              >
                {t(($) => $.shell.sourceControl.removeCredential)}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {snapshot.operation === "merge" || conflicts.length ? (
        <div className="mx-2 mt-2 rounded-md border border-amber-500/35 bg-amber-500/10 p-2">
          <div className="flex items-center gap-2 text-xs font-medium">
            <GitMerge className="size-3.5" />
            {t(($) =>
              snapshot.operation === "merge"
                ? $.shell.sourceControl.mergeNeedsAttention
                : $.shell.sourceControl.stashNeedsAttention,
            )}
          </div>
          <ul className="mt-1.5 space-y-1">
            {conflicts.map((conflict) => (
              <li
                key={conflict.path}
                className="rounded border border-amber-500/20 bg-background/40 p-1.5 text-[11px]"
              >
                <button
                  type="button"
                  onClick={() => void openSourceFile(conflict.path)}
                  className="block w-full truncate text-left font-medium underline-offset-2 hover:underline"
                >
                  {conflict.path}
                </button>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={busy}
                    onClick={() =>
                      externalAction((token, generation) =>
                        tauri.gitResolveConflict(
                          token.projectId,
                          conflict.path,
                          "current",
                          generation,
                        ),
                      )
                    }
                  >
                    {t(($) => $.shell.sourceControl.useCurrent)}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={busy}
                    onClick={() =>
                      externalAction((token, generation) =>
                        tauri.gitResolveConflict(
                          token.projectId,
                          conflict.path,
                          "incoming",
                          generation,
                        ),
                      )
                    }
                  >
                    {t(($) => $.shell.sourceControl.useIncoming)}
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={busy}
                    onClick={() =>
                      externalAction((token, generation) =>
                        tauri.gitResolveConflict(
                          token.projectId,
                          conflict.path,
                          "mark",
                          generation,
                        ),
                      )
                    }
                  >
                    {t(($) => $.shell.sourceControl.markResolved)}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {snapshot.operation === "merge" ? (
            <div className="mt-2 flex gap-1.5">
              <Button
                size="xs"
                disabled={busy || conflicts.length > 0}
                onClick={() =>
                  externalAction((token, generation) =>
                    tauri.gitContinueMerge(token.projectId, generation),
                  )
                }
              >
                {t(($) => $.shell.sourceControl.continueMerge)}
              </Button>
              <Button
                variant="outline"
                size="xs"
                disabled={busy}
                onClick={() => setAbortMergeOpen(true)}
              >
                {t(($) => $.shell.sourceControl.abortMerge)}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto pt-1">
        <SidebarSection
          id="source-control-staged"
          title={t(($) => $.shell.sourceControl.stagedChanges)}
          icon={<BookPlus aria-hidden className="size-3.5" />}
          count={staged.length}
          countLabel={t(($) => $.shell.sourceControl.stagedChangeCount, {
            count: staged.length,
          })}
          open={sectionOpen.staged}
          onOpenChange={(open) =>
            setSectionOpen((value) => ({ ...value, staged: open }))
          }
          actions={sectionActions("staged")}
        >
          {staged.length ? (
            staged.map(row)
          ) : (
            <div className="flex min-h-20 items-center justify-center gap-2.5 px-3 py-4 text-center text-muted-foreground/75">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/60">
                <BookPlus aria-hidden className="size-3.5" />
              </span>
              <p className="text-[11px] leading-4">
                {t(($) => $.shell.sourceControl.noStagedChanges)}
              </p>
            </div>
          )}
        </SidebarSection>
        <SidebarSection
          id="source-control-changes"
          title={t(($) => $.shell.sourceControl.changes)}
          icon={<Diff aria-hidden className="size-3.5" />}
          count={changes.length}
          countLabel={t(($) => $.shell.sourceControl.workingChangeCount, {
            count: changes.length,
          })}
          open={sectionOpen.changes}
          onOpenChange={(open) =>
            setSectionOpen((value) => ({ ...value, changes: open }))
          }
          actions={sectionActions("changes")}
        >
          {changes.length ? (
            changes.map(row)
          ) : (
            <p className="px-3 py-2 text-[11px] text-muted-foreground">
              {t(($) => $.shell.sourceControl.clean)}
            </p>
          )}
        </SidebarSection>
        <SidebarSection
          id="source-control-graph"
          title={t(($) => $.shell.sourceControl.graph)}
          icon={<GitBranch aria-hidden className="size-3.5" />}
          count={snapshot?.commits.length}
          countLabel={
            snapshot
              ? t(($) => $.shell.sourceControl.commitCount, {
                  count: snapshot.commits.length,
                })
              : undefined
          }
          open={sectionOpen.graph}
          onOpenChange={(open) =>
            setSectionOpen((value) => ({ ...value, graph: open }))
          }
        >
          {snapshot?.commits.length ? (
            <ol className="relative py-1">
              {snapshot.commits.length > 1 ? (
                <span
                  aria-hidden
                  className="absolute bottom-5 left-[18px] top-5 w-px bg-primary/40"
                />
              ) : null}
              {snapshot.commits.map((commit) => (
                <li
                  key={commit.oid}
                  className="group relative flex gap-2 px-3 py-1.5 pl-9 hover:bg-accent/60"
                >
                  <span
                    aria-hidden
                    className="absolute left-[14px] top-3 size-2.5 rounded-full border-2 border-sidebar bg-primary"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="truncate text-xs font-medium">
                        {commit.message.split("\n", 1)[0]}
                      </span>
                      {commit.refs?.map((ref) => (
                        <span
                          key={ref}
                          className="shrink-0 whitespace-nowrap rounded-full bg-primary/10 px-1.5 text-[10px] text-primary"
                        >
                          {ref.replace(" -> ", " \u2192 ")}
                        </span>
                      ))}
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {commit.author ?? commit.short}
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label={t(($) => $.shell.sourceControl.copyCommitId)}
                    onClick={() => void copyCommitId(commit)}
                    className="flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-accent"
                  >
                    {copiedOid === commit.oid ? (
                      <Check className="size-3" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={t(($) => $.shell.sourceControl.restoreCommit)}
                    disabled={busy || !commitFlowReady}
                    onClick={() => setRestoreCommit(commit)}
                    className="flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-accent"
                  >
                    <RotateCcw className="size-3" />
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <div className="flex min-h-20 items-center justify-center gap-2.5 px-3 py-4 text-center text-muted-foreground/75">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/60">
                <GitCommitHorizontal aria-hidden className="size-3.5" />
              </span>
              <p className="text-[11px] leading-4">
                {t(($) => $.shell.sourceControl.noHistory)}
              </p>
            </div>
          )}
        </SidebarSection>
      </div>
      {notice ? (
        <output
          data-testid="source-control-status"
          role={notice.ok ? undefined : "alert"}
          aria-live={notice.ok ? "polite" : undefined}
          className={cn(
            "m-2 rounded-md border p-2 text-[11px]",
            notice.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          {notice.text}
        </output>
      ) : null}
      <div
        data-testid="source-control-actions"
        className="shrink-0 border-t border-sidebar-border p-2"
      >
        <Input
          data-testid="commit-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={onCommitKeyDown}
          maxLength={COMMIT_TITLE_LIMIT}
          placeholder={t(($) => $.shell.sourceControl.commitTitle)}
          aria-label={t(($) => $.shell.sourceControl.commitTitle)}
          className="h-8 text-xs"
        />
        <Textarea
          data-testid="commit-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
          placeholder={t(
            ($) => $.shell.sourceControl.commitDescriptionPlaceholder,
          )}
          aria-label={t(($) => $.shell.sourceControl.commitDescription)}
          className="mt-1.5 min-h-14 resize-none text-xs"
        />
        <div className="mt-1.5 flex">
          <Tooltip
            label={commitBlocker ?? ""}
            suppressed={!commitBlocker}
            className="min-w-0 flex-1"
          >
            <Button
              data-testid="commit-button"
              size="sm"
              className="h-8 w-full rounded-r-none aria-[disabled=true]:pointer-events-none aria-[disabled=true]:opacity-50"
              disabled={busy}
              aria-disabled={!canCommit}
              onClick={() => {
                if (canCommit) void submit("commit");
              }}
            >
              {busy ? <Loader2 className="animate-spin" /> : <Check />}
              {t(($) => $.shell.sourceControl.commit)}
            </Button>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                className="h-8 rounded-l-none border-l border-primary-foreground/30 px-2"
                disabled={!canCommit && !canAmend}
                aria-label={t(($) => $.shell.sourceControl.commitActions)}
              >
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled={!canCommit}
                onSelect={() => void submit("commit")}
              >
                {t(($) => $.shell.sourceControl.commit)}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canAmend}
                onSelect={() => void submit("amend")}
              >
                {t(($) => $.shell.sourceControl.commitAmend)}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canCommit || !remote}
                onSelect={() => void submit("push")}
              >
                {t(($) => $.shell.sourceControl.commitAndPush)}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!canCommit || !remote}
                onSelect={() => void submit("sync")}
              >
                {t(($) => $.shell.sourceControl.commitAndSync)}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <ConfirmationDialog
        open={discardConfirmation !== null}
        title={discardConfirmation?.title ?? ""}
        description={discardConfirmation?.description ?? ""}
        confirmLabel={discardConfirmation?.confirm ?? ""}
        destructive
        onConfirm={confirmDiscard}
        onCancel={() => setDiscardConfirmation(null)}
      />
      <ConfirmationDialog
        open={restoreCommit !== null}
        title={t(($) => $.shell.sourceControl.restoreCommitTitle)}
        description={t(($) => $.shell.sourceControl.restoreCommitDescription)}
        confirmLabel={t(($) => $.shell.sourceControl.restoreCommit)}
        destructive
        onConfirm={() => void restoreGraphCommit()}
        onCancel={() => setRestoreCommit(null)}
      />
      <ConfirmationDialog
        open={abortMergeOpen}
        title={t(($) => $.shell.sourceControl.abortMergeTitle)}
        description={t(($) => $.shell.sourceControl.abortMergeDescription)}
        confirmLabel={t(($) => $.shell.sourceControl.abortMerge)}
        destructive
        onConfirm={() => {
          setAbortMergeOpen(false);
          externalAction((token, generation) =>
            tauri.gitAbortMerge(token.projectId, generation),
          );
        }}
        onCancel={() => setAbortMergeOpen(false)}
      />
      <PublishToGitHubDialog
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        projectId={projectId}
        projectName={projectName}
        currentRemote={remote}
        onPublished={() => {
          void refresh();
        }}
      />
    </div>
  );
}

function Header({
  branch,
  remote,
  aheadBehind,
  busy,
  onRefresh,
  onFetch,
  onPull,
  onPush,
  onSync,
  onStash,
  branches,
  onCheckout,
  branchFormOpen,
  onBranchFormOpen,
  branchDraft,
  onBranchDraft,
  onCreateBranch,
  onPublish,
  onUnlink,
  onCopyLink,
}: Readonly<{
  branch: string;
  remote: string | null;
  aheadBehind?: { ahead: number; behind: number } | null;
  busy: boolean;
  onRefresh: () => Promise<void>;
  onFetch?: () => void;
  onPull?: () => void;
  onPush?: () => void;
  onSync?: () => void;
  onStash?: (pop: boolean) => void;
  branches?: string[];
  onCheckout?: (branch: string) => void;
  branchFormOpen?: boolean;
  onBranchFormOpen?: (open: boolean) => void;
  branchDraft?: string;
  onBranchDraft?: (value: string) => void;
  onCreateBranch?: () => void;
  onPublish?: () => void;
  onUnlink?: () => void;
  onCopyLink?: (url: string) => void;
}>) {
  const { t } = useTranslation(["common", "shell"]);
  const url = remote ? toGithubWebUrl(remote) : null;
  const aheadBehindLabel = aheadBehind
    ? t(($) => $.shell.sourceControl.aheadBehind, {
        ahead: aheadBehind.ahead,
        behind: aheadBehind.behind,
        branch,
      })
    : "";
  const compactAheadBehind = aheadBehind
    ? `${String.fromCodePoint(0x2191)}${aheadBehind.ahead} ${String.fromCodePoint(0x2193)}${aheadBehind.behind}`
    : "";
  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-sidebar-border px-2">
        <GitBranch className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium uppercase tracking-wide text-sidebar-foreground/70">
          {t(($) => $.shell.sourceControl.title)}
        </span>
        <span className="ml-auto" />
        {branch ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
                className="h-6 max-w-32 gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 text-[11px] text-emerald-700 hover:bg-emerald-500/15 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200 [&_svg]:size-3"
                disabled={busy}
              >
                <GitBranch aria-hidden />
                <span className="truncate">{branch}</span>
                <ChevronDown aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>
                {t(($) => $.shell.sourceControl.branch)}
              </DropdownMenuLabel>
              {branches?.map((item) => (
                <DropdownMenuItem
                  key={item}
                  disabled={busy || item === branch}
                  onSelect={() => onCheckout?.(item)}
                >
                  {item}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem
                disabled={busy || !onCreateBranch}
                onSelect={() => onBranchFormOpen?.(true)}
              >
                {t(($) => $.shell.sourceControl.createBranch)}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {aheadBehind && (aheadBehind.ahead > 0 || aheadBehind.behind > 0) ? (
          <span
            className="shrink-0 text-[10px] tabular-nums text-muted-foreground"
            title={aheadBehindLabel}
          >
            {compactAheadBehind}
          </span>
        ) : null}
        <Tooltip label={t(($) => $.shell.sourceControl.refresh)}>
          <Button
            variant="ghost"
            size="icon"
            className="size-5 [&_svg]:size-3"
            aria-label={t(($) => $.shell.sourceControl.refresh)}
            disabled={busy}
            onClick={() => void onRefresh()}
          >
            <RefreshCw />
          </Button>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-5 [&_svg]:size-3"
              aria-label={t(($) => $.shell.sourceControl.moreActions)}
              disabled={busy}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={busy || !remote || !onFetch}
              onSelect={onFetch}
            >
              <CloudDownload className="size-3.5 shrink-0" />
              {t(($) => $.shell.sourceControl.fetch)}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={busy || !remote} onSelect={onPull}>
              <GitPullRequest className="size-3.5 shrink-0" />
              {t(($) => $.shell.sourceControl.pullShort)}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={busy || !remote} onSelect={onPush}>
              <Upload className="size-3.5 shrink-0" />
              {t(($) => $.shell.sourceControl.pushShort)}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={busy || !remote} onSelect={onSync}>
              <RefreshCw className="size-3.5 shrink-0" />
              {t(($) => $.shell.sourceControl.sync)}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={busy || !onStash}
              onSelect={() => onStash?.(false)}
            >
              <Archive className="size-3.5 shrink-0" />
              {t(($) => $.shell.sourceControl.stash)}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={busy || !onStash}
              onSelect={() => onStash?.(true)}
            >
              <RotateCcw className="size-3.5 shrink-0" />
              {t(($) => $.shell.sourceControl.popStash)}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={busy || !onPublish}
              onSelect={onPublish}
            >
              <Github className="size-3.5 shrink-0" />
              {t(($) =>
                remote
                  ? $.shell.sourceControl.changeRepo
                  : $.shell.sourceControl.publish,
              )}
            </DropdownMenuItem>
            {remote ? (
              <DropdownMenuItem
                disabled={busy}
                onSelect={onUnlink}
                className="text-destructive focus:text-destructive"
              >
                {t(($) => $.shell.sourceControl.unlink)}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        {url ? (
          <GithubMenu
            githubUrl={url}
            onOpenInGithub={() => void open(url)}
            onCopyLink={() => onCopyLink?.(url)}
          />
        ) : null}
      </div>
      {branchFormOpen ? (
        <div className="flex gap-1.5 border-b border-sidebar-border p-2">
          <Input
            autoFocus
            value={branchDraft}
            onChange={(event) => onBranchDraft?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onCreateBranch?.();
              if (event.key === "Escape") onBranchFormOpen?.(false);
            }}
            placeholder={t(($) => $.shell.sourceControl.branchName)}
            aria-label={t(($) => $.shell.sourceControl.branchName)}
            className="h-7 text-xs"
          />
          <Button
            size="xs"
            disabled={!branchDraft?.trim() || busy}
            onClick={onCreateBranch}
          >
            {t(($) => $.shell.sourceControl.create)}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t(($) => $.common.actions.cancel)}
            onClick={() => onBranchFormOpen?.(false)}
          >
            <X />
          </Button>
        </div>
      ) : null}
    </>
  );
}
