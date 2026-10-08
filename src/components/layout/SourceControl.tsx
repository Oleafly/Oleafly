import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
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
import { EmptyState } from "@/components/ui/empty";
import { useCopyStatus } from "@/components/ui/use-copy-status";
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
import { GitStatusBadge, gitStatusMeta } from "@/components/files/gitStatus";
import { useDiffStore } from "@/store/diff";
import { useFilesStore } from "@/store/files";
import { useGitStatusStore } from "@/store/git-status";
import { sameGitChanges } from "@/lib/git-changes";
import { projectFolderAvailable, reportLocationError } from "@/store/project-availability";
import { folderIsRestricted, useFolderAccessStore } from "@/store/folder-access";
import { PublishToGitHubDialog } from "@/components/integrations/PublishToGitHubDialog";
import { GithubMenu } from "@/components/layout/GithubMenu";
import { SidebarPanelHeader, SidebarSection } from "@/components/layout/SidebarSection";
import {
  consumeSourceControlGraphRequest,
  SOURCE_CONTROL_SHOW_GRAPH_EVENT,
} from "@/lib/source-control-events";
import { toGithubWebUrl } from "@/lib/github-url";
import { describeError } from "@/lib/app-error";
import { dirname } from "@/lib/path-utils";
import { cn, isMac, isWindows } from "@/lib/utils";
import { open } from "@tauri-apps/plugin-shell";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { useRowWindow } from "@/hooks/use-row-window";
import { useOverlayScrollbar } from "@/hooks/use-overlay-scrollbar";
import { useHotRow } from "@/hooks/use-hot-row";
import { useDelegatedTooltips } from "@/components/ui/delegated-tooltip";
import {
  type ScrollMemory,
  useScrollMemory,
  useScrollMemoryLayout,
} from "@/hooks/use-scroll-memory";
import { useSidebarViewMemory } from "@/hooks/use-sidebar-view-memory";
import { readSidebarView } from "@/store/sidebar-view-state";

type GitGraphCommit = GitCommit;
type Translate = ReturnType<typeof useTranslation<["shell"]>>["t"];
type ProjectStateResult = { projectState: ProjectStateChanged };
type CommitSubmissionResult = {
  committed: true;
  remoteError?: unknown;
  conflicts?: boolean;
};
const COMMIT_TITLE_LIMIT = 72;
const OPEN_SECTIONS = { staged: true, changes: true, graph: true };
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
  const { t } = useTranslation(["common", "shell", "errors"]);
  const projectId = useFilesStore((s) => s.projectId);
  const folderRestricted = useFolderAccessStore((s) => folderIsRestricted(s, projectId));
  const lockedRepository = useFolderAccessStore((s) =>
    s.projectId === projectId && s.trust?.trusted && s.trust.repository?.trusted === false
      ? s.trust.repository.name
      : null,
  );
  const trusting = useFolderAccessStore((s) => s.trusting);
  const grantTrust = useFolderAccessStore((s) => s.grant);
  const trustPending = useFolderAccessStore((s) => s.projectId === projectId && !s.loaded);
  const gitLocked = folderRestricted || lockedRepository !== null;
  const refreshBlocked = gitLocked || trustPending;
  const projectName = useFilesStore((s) => s.projectName);
  const openFile = useFilesStore((s) => s.openFile);
  const refreshTree = useFilesStore((s) => s.refreshTree);
  const pullFromGit = useFilesStore((s) => s.pullFromGit);
  const restoreFromGit = useFilesStore((s) => s.restoreFromGit);
  const openDiff = useDiffStore((s) => s.openDiff);
  const clearActiveDiff = useDiffStore((s) => s.clearActiveDiff);
  const [remembered] = useState(() => readSidebarView(projectId, "sourceControl"));
  const [snapshot, setSnapshot] = useState<GitWorkspaceSnapshot | null>(
    remembered?.snapshot ?? null,
  );
  const [title, setTitle] = useState(remembered?.title ?? "");
  const [description, setDescription] = useState(remembered?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [publishOpen, setPublishOpen] = useState(false);
  const [credentialCleanupRequired, setCredentialCleanupRequired] =
    useState(false);
  const [discardConfirmation, setDiscardConfirmation] =
    useState<Confirmation>(null);
  const [sectionOpen, setSectionOpen] = useState(
    remembered?.sectionOpen ?? OPEN_SECTIONS,
  );
  const [branchFormOpen, setBranchFormOpen] = useState(
    remembered?.branchFormOpen ?? false,
  );
  const [branchDraft, setBranchDraft] = useState(remembered?.branchDraft ?? "");
  useSidebarViewMemory(projectId, "sourceControl", {
    snapshot,
    title,
    description,
    sectionOpen,
    branchFormOpen,
    branchDraft,
  });
  const [abortMergeOpen, setAbortMergeOpen] = useState(false);
  const [restoreCommit, setRestoreCommit] = useState<GitGraphCommit | null>(
    null,
  );
  const {
    copiedText: copiedOid,
    copy: copyCommitOid,
    reset: resetCopiedOid,
  } = useCopyStatus({ onError: (error) => setNotice({ ok: false, text: describeError(error) }) });
  const scrollRef = useRef<HTMLDivElement>(null);
  useOverlayScrollbar(scrollRef);
  const scrollMemory = useScrollMemory({
    scrollRef,
    projectId,
    slot: "sourceControl",
    ready: snapshot !== null,
  });
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
    const next = readSidebarView(projectId, "sourceControl");
    setSnapshot(next?.snapshot ?? null);
    setTitle(next?.title ?? "");
    setDescription(next?.description ?? "");
    setSectionOpen(next?.sectionOpen ?? OPEN_SECTIONS);
    setBusy(false);
    setNotice(null);
    setCredentialCleanupRequired(false);
    setDiscardConfirmation(null);
    setBranchDraft(next?.branchDraft ?? "");
    setBranchFormOpen(next?.branchFormOpen ?? false);
    setRestoreCommit(null);
    setAbortMergeOpen(false);
    resetCopiedOid();
    setPublishOpen(false);
  }, [projectId, resetCopiedOid]);
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
    if (
      !projectId ||
      refreshBlocked ||
      useFilesStore.getState().projectId !== projectId ||
      !projectFolderAvailable(projectId)
    )
      return;
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
      setSnapshot((current) => (sameSnapshot(current, next) ? current : next));
      setCredentialCleanupRequired(next.initialized && needsCredentialCleanup);
      useGitStatusStore.getState().apply(projectId, next.changes);
    } catch (error) {
      if (reportLocationError(projectId, error)) return;
      if (
        request === refreshRequest.current &&
        useFilesStore.getState().projectId === projectId
      )
        setNotice({ ok: false, text: describeError(error) });
    }
  }, [projectId, refreshBlocked]);
  const refreshOnceRef = useRef(refreshOnce);
  useLayoutEffect(() => {
    refreshOnceRef.current = refreshOnce;
  }, [refreshOnce]);
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
      try {
        do {
          operation.queued = false;
          await refreshOnceRef.current();
        } while (operation.queued && pendingRefresh.current === operation);
      } finally {
        if (pendingRefresh.current === operation) pendingRefresh.current = null;
      }
    })();
    return operation.promise;
  }, [projectId]);
  useEffect(() => {
    void refresh();
    const changed = () => void refresh();
    window.addEventListener("oleafly:git-changed", changed);
    return () => window.removeEventListener("oleafly:git-changed", changed);
  }, [refresh]);
  const lockSeen = useRef({ projectId, gitLocked, refreshBlocked });
  useEffect(() => {
    const seen = lockSeen.current;
    lockSeen.current = { projectId, gitLocked, refreshBlocked };
    if (seen.projectId !== projectId) return;
    if (seen.gitLocked !== gitLocked) {
      refreshRequest.current += 1;
      setNotice(null);
    }
    if (seen.refreshBlocked && !refreshBlocked) void refresh();
  }, [gitLocked, projectId, refresh, refreshBlocked]);
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
      setNotice({ ok: false, text: describeError(error) });
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
      setNotice({ ok: false, text: describeError(error) });
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
  const restoreGraphCommit = async () => {
    const commit = restoreCommit;
    const token = begin();
    if (!commit || !token) return;
    setRestoreCommit(null);
    await mutate(token, () => restoreFromGit(token.projectId, commit.oid));
    if (current(token)) await refreshTree();
  };
  const rowHandlers = useRef<ChangeRowActions | null>(null);
  rowHandlers.current = {
    open: openChange,
    openFile: (path) => void openSourceFile(path),
    discard: requestDiscard,
    stage: stagePaths,
    unstage: unstagePaths,
  };
  const rowActions = useMemo<ChangeRowActions>(
    () => ({
      open: (change) => rowHandlers.current?.open(change),
      openFile: (path) => rowHandlers.current?.openFile(path),
      discard: (paths) => rowHandlers.current?.discard(paths),
      stage: (paths) => rowHandlers.current?.stage(paths),
      unstage: (paths) => rowHandlers.current?.unstage(paths),
    }),
    [],
  );
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
  if (projectId && gitLocked)
    return (
      <div className="flex h-full flex-col bg-sidebar">
        <Header branch="" remote={null} busy={busy} onRefresh={refresh} />
        <div
          data-testid="source-control-restricted"
          className="flex flex-1 flex-col items-center justify-center gap-3 px-5 text-center"
        >
          <ShieldAlert aria-hidden className="size-6 text-muted-foreground/60" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {lockedRepository === null
              ? t(($) => $.errors.trust.git)
              : t(($) => $.errors.trust.repository, { name: lockedRepository })}
          </p>
          <Button
            size="sm"
            disabled={trusting !== null}
            onClick={() => void grantTrust(lockedRepository === null ? "folder" : "repository")}
          >
            {trusting !== null ? (
              <Spinner size="sm" />
            ) : null}
            {lockedRepository === null
              ? t(($) => $.shell.openedFolder.trust.trustFolder)
              : t(($) => $.shell.openedFolder.trust.trustRepository)}
          </Button>
        </div>
      </div>
    );
  if (!projectId || snapshot === null)
    return (
      <div className="flex h-full flex-col bg-sidebar">
        <Header branch="" remote={null} busy={busy} onRefresh={refresh} />
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 text-center">
          {projectId && !notice ? (
            <Spinner size="lg" className="text-muted-foreground" />
          ) : (
            <GitBranch className="size-6 text-muted-foreground/60" />
          )}
          <p
            role={notice?.ok === false ? "alert" : undefined}
            className={cn(
              "text-xs text-muted-foreground",
              notice?.ok === false && "select-text text-destructive",
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
  if (snapshot.gitAvailable === false)
    return (
      <div className="flex h-full flex-col bg-sidebar">
        <Header branch="" remote={null} busy={busy} onRefresh={refresh} />
        <GitMissingGuide />
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
        <EmptyState
          size="compact"
          className="flex-1 px-5"
          icon={<GitBranch className="size-8 text-muted-foreground/60" />}
          title={t(($) => $.shell.sourceControl.notInitialized)}
          description={t(($) => $.shell.sourceControl.notInitializedHint)}
        >
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
                notice.ok ? "text-muted-foreground" : "select-text text-destructive",
              )}
            >
              {notice.text}
            </p>
          ) : null}
        </EmptyState>
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
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="isolate min-h-0 flex-1 overflow-auto pt-1">
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
            <ChangeRows
              changes={staged}
              busy={busy}
              actions={rowActions}
              scrollRef={scrollRef}
              scrollMemory={scrollMemory}
            />
          ) : (
            <div className="flex min-h-20 flex-col items-center justify-center gap-2 px-3 py-4 text-center text-muted-foreground/75">
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
            <ChangeRows
              changes={changes}
              busy={busy}
              actions={rowActions}
              scrollRef={scrollRef}
              scrollMemory={scrollMemory}
            />
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
                        <Badge key={ref} variant="primaryGhost" size="sm">
                          {ref.replace(" -> ", " \u2192 ")}
                        </Badge>
                      ))}
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      {commit.author ?? commit.short}
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label={t(($) => $.shell.sourceControl.copyCommitId)}
                    onClick={() => void copyCommitOid(commit.oid)}
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
            <div className="flex min-h-20 flex-col items-center justify-center gap-2 px-3 py-4 text-center text-muted-foreground/75">
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
      </div>
      {notice ? (
        <output
          data-testid="source-control-status"
          role={notice.ok ? undefined : "alert"}
          aria-live={notice.ok ? "polite" : undefined}
          className={cn(
            "m-2 select-text rounded-md border p-2 text-[11px]",
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
              {busy ? <Spinner /> : <Check />}
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

type HostOs = "windows" | "mac" | "linux";
function hostOs(windows: boolean, mac: boolean): HostOs {
  if (windows) return "windows";
  if (mac) return "mac";
  return "linux";
}
const HOST_OS: HostOs = hostOs(isWindows, isMac);
const GIT_FOR_WINDOWS_URL = "https://git-scm.com/downloads/win";
const MAC_TOOLS_COMMAND = "xcode-select --install";

/** Shown instead of Source Control when no usable Git is installed: how to
 * get Git on this operating system, with at most one action. */
export function GitMissingGuide({ os = HOST_OS }: Readonly<{ os?: HostOs }>) {
  const { t } = useTranslation(["shell"]);
  const [copied, setCopied] = useState(false);
  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(MAC_TOOLS_COMMAND);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 text-center">
      <GitBranch aria-hidden className="size-8 text-muted-foreground/60" />
      <p className="text-xs font-medium">
        {t(($) => $.shell.sourceControl.gitMissing.title)}
      </p>
      {os === "windows" ? (
        <>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t(($) => $.shell.sourceControl.gitMissing.windows)}
          </p>
          <Button size="sm" onClick={() => void open(GIT_FOR_WINDOWS_URL)}>
            {t(($) => $.shell.sourceControl.gitMissing.download)}
          </Button>
        </>
      ) : null}
      {os === "mac" ? (
        <>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t(($) => $.shell.sourceControl.gitMissing.mac)}
          </p>
          <code className="select-all rounded bg-muted px-2 py-1 font-mono text-[11px]">
            {MAC_TOOLS_COMMAND}
          </code>
          <Button size="sm" variant="outline" onClick={() => void copyCommand()}>
            {copied ? (
              <Check aria-hidden className="size-3.5" />
            ) : (
              <Copy aria-hidden className="size-3.5" />
            )}
            {copied
              ? t(($) => $.shell.sourceControl.gitMissing.copied)
              : t(($) => $.shell.sourceControl.gitMissing.copyCommand)}
          </Button>
        </>
      ) : null}
      {os === "linux" ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {t(($) => $.shell.sourceControl.gitMissing.linux)}
        </p>
      ) : null}
    </div>
  );
}

function sameSnapshot(
  current: GitWorkspaceSnapshot | null,
  next: GitWorkspaceSnapshot,
): boolean {
  if (!current) return false;
  const { changes: currentChanges, ...currentRest } = current;
  const { changes: nextChanges, ...nextRest } = next;
  return (
    sameGitChanges(currentChanges, nextChanges) &&
    JSON.stringify(currentRest) === JSON.stringify(nextRest)
  );
}

type ChangeRowActions = Readonly<{
  open: (change: GitFileChange) => void;
  openFile: (path: string) => void;
  discard: (paths: string[]) => void;
  stage: (paths: string[]) => void;
  unstage: (paths: string[]) => void;
}>;

function rowKeyOf(change: GitFileChange): string {
  return `${change.staged ? "staged" : "change"}:${change.path}`;
}

const ChangeRow = memo(function ChangeRow({
  change,
  busy,
  actions,
  t,
  hot,
}: Readonly<{
  change: GitFileChange;
  busy: boolean;
  actions: ChangeRowActions;
  t: Translate;
  hot: boolean;
}>) {
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
  const directory = dirname(change.path);
  let stageIcon = null;
  if (hot) stageIcon = change.staged ? <RotateCcw className="size-3.5" /> : <Plus className="size-3.5" />;
  return (
    <div
      data-row-window-item
      data-hot-row={rowKeyOf(change)}
      className="group flex h-9 w-full items-center gap-1 pl-4 pr-2 hover:bg-accent/60 focus-within:bg-accent/60"
    >
      <button
        type="button"
        data-testid={`git-change-${change.path}`}
        aria-describedby={statusId}
        onClick={() => actions.open(change)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded text-left focus-visible:bg-accent/60"
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
      <button
        type="button"
        aria-label={openLabel}
        data-tooltip={t(($) => $.shell.sourceControl.openFile)}
        onClick={() => actions.openFile(change.path)}
        className="flex size-6 items-center justify-center rounded text-transparent group-hover:text-muted-foreground focus-visible:text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        {hot ? <FileSymlink className="size-3.5" /> : null}
      </button>
      {change.staged ? null : (
        <button
          type="button"
          aria-label={discardLabel}
          data-tooltip={t(($) => $.shell.sourceControl.discard)}
          disabled={busy}
          onClick={() => actions.discard([change.path])}
          className="flex size-6 items-center justify-center rounded text-transparent group-hover:text-muted-foreground focus-visible:text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          {hot ? <Undo2 className="size-3.5" /> : null}
        </button>
      )}
      <button
        type="button"
        aria-label={stageLabel}
        data-tooltip={
          change.staged
            ? t(($) => $.shell.sourceControl.unstage)
            : t(($) => $.shell.sourceControl.stage)
        }
        disabled={busy}
        onClick={() =>
          change.staged
            ? actions.unstage([change.path])
            : actions.stage([change.path])
        }
        className="flex size-6 items-center justify-center rounded text-transparent group-hover:text-muted-foreground focus-visible:text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        {stageIcon}
      </button>
      <GitStatusBadge
        meta={gitStatusMeta(change.status)}
        id={statusId}
        testId={`git-status-${change.staged ? "staged" : "working"}-${change.path}`}
        className="ml-1"
      />
    </div>
  );
});

function ChangeRows({
  changes,
  busy,
  actions,
  scrollRef,
  scrollMemory,
}: Readonly<{
  changes: readonly GitFileChange[];
  busy: boolean;
  actions: ChangeRowActions;
  scrollRef: RefObject<HTMLDivElement | null>;
  scrollMemory: ScrollMemory;
}>) {
  const { t } = useTranslation(["shell"]);
  const listRef = useRef<HTMLDivElement>(null);
  const rows = useRowWindow({ count: changes.length, scrollRef, listRef });
  const tooltip = useDelegatedTooltips(listRef);
  const hotRow = useHotRow(listRef);
  useScrollMemoryLayout(scrollMemory);
  return (
    <div
      ref={listRef}
      style={{ paddingTop: rows.paddingTop, paddingBottom: rows.paddingBottom }}
    >
      {changes.slice(rows.start, rows.end).map((change) => (
        <ChangeRow
          key={rowKeyOf(change)}
          change={change}
          busy={busy}
          actions={actions}
          t={t}
          hot={hotRow === rowKeyOf(change)}
        />
      ))}
      {tooltip}
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
      <SidebarPanelHeader icon={GitBranch} title={t(($) => $.shell.sourceControl.title)}>
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
      </SidebarPanelHeader>
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
