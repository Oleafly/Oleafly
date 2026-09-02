import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  ArchiveRestore,
  Database,
  Download,
  FileCog,
  FileUp,
  History,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useModalAccessibility } from "@/components/ui/use-modal-accessibility";
import {
  checkpointDelete,
  checkpointExport,
  checkpointImport,
  checkpointKeepLatest,
  checkpointList,
  checkpointReset,
  checkpointRestore,
  checkpointStats,
  type CheckpointStoreStats,
  type CheckpointSummary,
} from "@/lib/checkpoints";
import { logError } from "@/lib/log";
import { pickOpenPath, pickSavePath } from "@/lib/native-file-dialog";
import {
  getProject,
  setProjectCheckpointPolicy,
  type CheckpointPolicy,
} from "@/lib/tauri";
import { notifyError, toast } from "@/lib/toast";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

type Confirmation =
  | { kind: "restore" | "delete"; snapshotRoot: string }
  | { kind: "keep-latest" | "reset" }
  | null;

const DEFAULT_CHECKPOINT_POLICY: CheckpointPolicy = {
  mode: "engine_dependencies",
  always_include: [],
  ignored: [],
};

type PolicyIssue = {
  kind: "malformed" | "unsupported";
  preview: string;
};

type ParsedPolicy =
  | { kind: "supported"; policy: CheckpointPolicy }
  | PolicyIssue;

type ModalActionToken = {
  projectId: string;
  session: number;
  request: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePatternArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return null;
  }
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function policyPreview(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return "Stored policy data could not be displayed.";
  }
}

function parsePolicy(value: unknown): ParsedPolicy {
  const preview = policyPreview(value);
  if (!isRecord(value) || typeof value.mode !== "string") {
    return { kind: "malformed", preview };
  }
  const alwaysInclude = normalizePatternArray(value.always_include);
  const ignored = normalizePatternArray(value.ignored);
  if (!alwaysInclude || !ignored) {
    return { kind: "malformed", preview };
  }
  if (value.mode !== "engine_dependencies") {
    return { kind: "unsupported", preview };
  }
  return {
    kind: "supported",
    policy: {
      ...value,
      mode: "engine_dependencies",
      always_include: alwaysInclude,
      ignored,
    },
  };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unit;
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: unit === 0 ? 0 : value >= 10 ? 1 : 2,
  })} ${units[unit]}`;
}

function formatCompletedAt(value: number): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time not recorded" : date.toLocaleString();
}

function safeArchiveName(name: string): string {
  const safe = name.trim().replace(/[^\w.-]+/g, "_").replace(/^\.+|\.+$/g, "");
  return safe || "project";
}

function patternLines(value: string): string[] {
  return [...new Set(value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean))];
}

function StoreSummary({ stats }: { stats: CheckpointStoreStats }) {
  const items = [
    { label: "Checkpoints", value: stats.checkpoint_count.toLocaleString() },
    { label: "Stored", value: formatBytes(stats.stored_pack_bytes) },
    { label: "Source size", value: formatBytes(stats.logical_bytes) },
    { label: "Reclaimable", value: formatBytes(stats.reclaimable_bytes) },
  ];

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y bg-muted/20 px-4 py-3 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">{item.label}</dt>
          <dd className="truncate text-sm font-medium tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

interface CheckpointRowProps {
  checkpoint: CheckpointSummary;
  busy: boolean;
  confirmation: Confirmation;
  onConfirm: (confirmation: Confirmation) => void;
  onRestore: (checkpoint: CheckpointSummary) => void;
  onDelete: (checkpoint: CheckpointSummary) => void;
}

function CheckpointRow({
  checkpoint,
  busy,
  confirmation,
  onConfirm,
  onRestore,
  onDelete,
}: CheckpointRowProps) {
  const restoring =
    confirmation?.kind === "restore" && confirmation.snapshotRoot === checkpoint.snapshot_root;
  const deleting =
    confirmation?.kind === "delete" && confirmation.snapshotRoot === checkpoint.snapshot_root;
  const completedAt = formatCompletedAt(checkpoint.completed_at_unix_ms);

  return (
    <li className="rounded-lg border bg-background/70 px-3 py-3">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
        >
          <ShieldCheck className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{completedAt}</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {checkpoint.engine || "Unknown engine"} ·{" "}
            {checkpoint.toolchain_identity || "Toolchain not recorded"} ·{" "}
            {checkpoint.main_document || "Main document not recorded"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() =>
              onConfirm({ kind: "restore", snapshotRoot: checkpoint.snapshot_root })
            }
          >
            <RotateCcw className="size-3.5" />
            Restore
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            aria-label={`Delete checkpoint from ${completedAt}`}
            disabled={busy}
            onClick={() =>
              onConfirm({ kind: "delete", snapshotRoot: checkpoint.snapshot_root })
            }
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1 pl-10 text-xs">
        <dt className="text-muted-foreground">Snapshot root</dt>
        <dd className="truncate font-mono" title={checkpoint.snapshot_root}>
          {checkpoint.snapshot_root || "Not recorded"}
        </dd>
        <dt className="text-muted-foreground">Output proof</dt>
        <dd className="truncate font-mono" title={checkpoint.output_hash}>
          {checkpoint.output_hash || "Not recorded"}
        </dd>
        <dt className="text-muted-foreground">Captured source</dt>
        <dd>
          {checkpoint.file_count.toLocaleString()} {checkpoint.file_count === 1 ? "file" : "files"} ·{" "}
          {formatBytes(checkpoint.logical_bytes)}
        </dd>
      </dl>

      {restoring ? (
        <div className="mt-3 rounded-md bg-amber-500/10 px-3 py-2 text-xs" role="status">
          <p className="text-foreground">
            Restore this checkpoint? Current project files will be replaced. No new checkpoint is created.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button autoFocus size="sm" disabled={busy} onClick={() => onRestore(checkpoint)}>
              Restore checkpoint
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onConfirm(null)}>
              Keep current files
            </Button>
          </div>
        </div>
      ) : null}

      {deleting ? (
        <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs" role="status">
          <p className="text-foreground">
            Delete this checkpoint permanently? This cannot be undone.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button
              autoFocus
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => onDelete(checkpoint)}
            >
              Delete checkpoint
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => onConfirm(null)}>
              Keep checkpoint
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function CheckpointsModal() {
  const open = useSettingsStore((state) => state.checkpointsOpen);
  const setOpen = useSettingsStore((state) => state.setCheckpointsOpen);
  const projectId = useFilesStore((state) => state.projectId);
  const projectName = useFilesStore((state) => state.projectName);
  const [checkpoints, setCheckpoints] = useState<CheckpointSummary[]>([]);
  const [stats, setStats] = useState<CheckpointStoreStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savedPolicy, setSavedPolicy] = useState<CheckpointPolicy | null>(null);
  const [policyIssue, setPolicyIssue] = useState<PolicyIssue | null>(null);
  const [alwaysInclude, setAlwaysInclude] = useState("");
  const [ignored, setIgnored] = useState("");
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const loadRequest = useRef(0);
  const policyRequest = useRef(0);
  const sessionRequest = useRef(0);
  const actionRequest = useRef(0);
  const renderedIdentity = useRef({ open, projectId });
  const renderIdentityChanged =
    renderedIdentity.current.open !== open ||
    renderedIdentity.current.projectId !== projectId;
  const close = useCallback(() => {
    if (!busyAction && !policySaving) setOpen(false);
  }, [busyAction, policySaving, setOpen]);
  const { dialogRef, onBackdropMouseDown } = useModalAccessibility<HTMLDivElement>(open, close);

  const applyLoadedPolicy = useCallback((value: unknown) => {
    const parsed = parsePolicy(value);
    if (parsed.kind === "supported") {
      setSavedPolicy(parsed.policy);
      setPolicyIssue(null);
      setAlwaysInclude(parsed.policy.always_include.join("\n"));
      setIgnored(parsed.policy.ignored.join("\n"));
      return;
    }
    setSavedPolicy(null);
    setPolicyIssue(parsed);
    setAlwaysInclude("");
    setIgnored("");
  }, []);

  const isCurrentSession = useCallback(
    (targetProjectId: string | null, session: number) =>
      session === sessionRequest.current &&
      useFilesStore.getState().projectId === targetProjectId &&
      useSettingsStore.getState().checkpointsOpen,
    [],
  );

  const beginAction = useCallback(
    (targetProjectId: string): ModalActionToken | null => {
      if (renderIdentityChanged) return null;
      return {
        projectId: targetProjectId,
        session: sessionRequest.current,
        request: ++actionRequest.current,
      };
    },
    [renderIdentityChanged],
  );

  const isCurrentAction = useCallback(
    (token: ModalActionToken) =>
      token.request === actionRequest.current &&
      isCurrentSession(token.projectId, token.session),
    [isCurrentSession],
  );

  const refresh = useCallback(
    async (targetProjectId: string | null, showLoading: boolean, session: number) => {
      if (!isCurrentSession(targetProjectId, session)) return;
      const request = ++loadRequest.current;
      if (!targetProjectId) {
        setCheckpoints([]);
        setStats(null);
        setLoading(false);
        setLoadError(null);
        return;
      }
      if (showLoading) setLoading(true);
      setLoadError(null);
      try {
        const [nextCheckpoints, nextStats] = await Promise.all([
          checkpointList(targetProjectId),
          checkpointStats(targetProjectId),
        ]);
        if (
          request !== loadRequest.current ||
          !isCurrentSession(targetProjectId, session)
        ) {
          return;
        }
        setCheckpoints(nextCheckpoints);
        setStats(nextStats);
      } catch (error) {
        if (
          request !== loadRequest.current ||
          !isCurrentSession(targetProjectId, session)
        ) {
          return;
        }
        void logError("load checkpoints", error);
        setLoadError("Couldn't load checkpoints. Try again.");
      } finally {
        if (
          request === loadRequest.current &&
          isCurrentSession(targetProjectId, session)
        ) {
          setLoading(false);
        }
      }
    },
    [isCurrentSession],
  );

  const loadPolicy = useCallback(
    async (targetProjectId: string | null, session: number) => {
      if (!isCurrentSession(targetProjectId, session)) return;
      const request = ++policyRequest.current;
      if (!targetProjectId) {
        setSavedPolicy(null);
        setPolicyIssue(null);
        setAlwaysInclude("");
        setIgnored("");
        setPolicyLoading(false);
        setPolicyError(null);
        return;
      }
      setPolicyLoading(true);
      setPolicyError(null);
      try {
        const meta = await getProject(targetProjectId);
        if (
          request !== policyRequest.current ||
          !isCurrentSession(targetProjectId, session)
        ) {
          return;
        }
        const storedPolicy: unknown = (meta as { checkpoints?: unknown }).checkpoints;
        applyLoadedPolicy(
          storedPolicy === undefined ? DEFAULT_CHECKPOINT_POLICY : storedPolicy,
        );
      } catch (error) {
        if (
          request !== policyRequest.current ||
          !isCurrentSession(targetProjectId, session)
        ) {
          return;
        }
        void logError("load checkpoint policy", error);
        setPolicyError("Couldn't load this project's checkpoint policy.");
      } finally {
        if (
          request === policyRequest.current &&
          isCurrentSession(targetProjectId, session)
        ) {
          setPolicyLoading(false);
        }
      }
    },
    [applyLoadedPolicy, isCurrentSession],
  );

  useLayoutEffect(() => {
    renderedIdentity.current = { open, projectId };
    const session = ++sessionRequest.current;
    actionRequest.current += 1;
    loadRequest.current += 1;
    policyRequest.current += 1;
    setBusyAction(null);
    setPolicySaving(false);
    setConfirmation(null);
    setPassword("");
    setPasswordError(null);
    if (!open) {
      setLoading(false);
      setPolicyLoading(false);
      return;
    }
    setCheckpoints([]);
    setStats(null);
    setSavedPolicy(null);
    setPolicyIssue(null);
    setAlwaysInclude("");
    setIgnored("");
    void refresh(projectId, true, session);
    void loadPolicy(projectId, session);
  }, [open, projectId, loadPolicy, refresh]);

  if (!open) return null;

  const restore = async (checkpoint: CheckpointSummary) => {
    if (!projectId) return;
    const action = beginAction(projectId);
    if (!action || !isCurrentAction(action)) return;
    setBusyAction(`restore:${checkpoint.snapshot_root}`);
    try {
      const files = useFilesStore.getState();
      const expectedGeneration = await files.prepareExternalMutation(action.projectId);
      if (!isCurrentAction(action)) return;
      const event = await checkpointRestore(
        action.projectId,
        checkpoint.snapshot_root,
        expectedGeneration,
      );
      if (!isCurrentAction(action)) return;
      const applied = await useFilesStore.getState().applyProjectStateChanged(event);
      if (!isCurrentAction(action)) return;
      if (!applied) {
        throw new Error("The open project changed before the restored files could be shown.");
      }
      toast.success("Checkpoint restored.");
      setOpen(false);
    } catch (error) {
      if (!isCurrentAction(action)) return;
      notifyError(
        "restore checkpoint",
        error,
        "Couldn't restore this checkpoint. See the app log for details.",
      );
    } finally {
      if (isCurrentAction(action)) {
        setBusyAction(null);
        setConfirmation(null);
      }
    }
  };

  const deleteCheckpoint = async (checkpoint: CheckpointSummary) => {
    if (!projectId) return;
    const action = beginAction(projectId);
    if (!action || !isCurrentAction(action)) return;
    setBusyAction(`delete:${checkpoint.snapshot_root}`);
    try {
      await checkpointDelete(action.projectId, checkpoint.snapshot_root);
      if (!isCurrentAction(action)) return;
      setConfirmation(null);
      await refresh(action.projectId, false, action.session);
      if (!isCurrentAction(action)) return;
      toast.success("Checkpoint deleted.");
    } catch (error) {
      if (!isCurrentAction(action)) return;
      notifyError("delete checkpoint", error, "Couldn't delete this checkpoint.");
    } finally {
      if (isCurrentAction(action)) setBusyAction(null);
    }
  };

  const keepLatest = async () => {
    if (!projectId) return;
    const action = beginAction(projectId);
    if (!action || !isCurrentAction(action)) return;
    setBusyAction("keep-latest");
    try {
      await checkpointKeepLatest(action.projectId);
      if (!isCurrentAction(action)) return;
      setConfirmation(null);
      await refresh(action.projectId, false, action.session);
      if (!isCurrentAction(action)) return;
      toast.success("Older checkpoints deleted.");
    } catch (error) {
      if (!isCurrentAction(action)) return;
      notifyError("keep latest checkpoint", error, "Couldn't delete older checkpoints.");
    } finally {
      if (isCurrentAction(action)) setBusyAction(null);
    }
  };

  const reset = async () => {
    if (!projectId) return;
    const action = beginAction(projectId);
    if (!action || !isCurrentAction(action)) return;
    setBusyAction("reset");
    try {
      await checkpointReset(action.projectId);
      if (!isCurrentAction(action)) return;
      setConfirmation(null);
      await refresh(action.projectId, false, action.session);
      if (!isCurrentAction(action)) return;
      toast.success("All checkpoints deleted.");
    } catch (error) {
      if (!isCurrentAction(action)) return;
      notifyError("reset checkpoints", error, "Couldn't reset checkpoints.");
    } finally {
      if (isCurrentAction(action)) setBusyAction(null);
    }
  };

  const savePolicy = async () => {
    if (!projectId || !savedPolicy) return;
    const action = beginAction(projectId);
    if (!action || !isCurrentAction(action)) return;
    const nextPolicy: CheckpointPolicy = {
      ...savedPolicy,
      mode: "engine_dependencies",
      always_include: patternLines(alwaysInclude),
      ignored: patternLines(ignored),
    };
    setPolicySaving(true);
    setPolicyError(null);
    try {
      const meta = await setProjectCheckpointPolicy(action.projectId, nextPolicy);
      if (!isCurrentAction(action)) return;
      const persisted: unknown = (meta as { checkpoints?: unknown }).checkpoints;
      applyLoadedPolicy(persisted === undefined ? nextPolicy : persisted);
      toast.success("Checkpoint policy saved.");
    } catch (error) {
      if (!isCurrentAction(action)) return;
      void logError("save checkpoint policy", error);
      const detail =
        error instanceof Error ? error.message : typeof error === "string" ? error : "";
      setPolicyError(detail || "Couldn't save this project's checkpoint policy.");
    } finally {
      if (isCurrentAction(action)) setPolicySaving(false);
    }
  };

  const discardPolicyChanges = () => {
    if (!savedPolicy) return;
    setAlwaysInclude(savedPolicy.always_include.join("\n"));
    setIgnored(savedPolicy.ignored.join("\n"));
    setPolicyError(null);
  };

  const resetToSafePolicy = async () => {
    if (!projectId) return;
    const action = beginAction(projectId);
    if (!action || !isCurrentAction(action)) return;
    const safePolicy: CheckpointPolicy = {
      mode: "engine_dependencies",
      always_include: [],
      ignored: [],
    };
    setPolicySaving(true);
    setPolicyError(null);
    try {
      const meta = await setProjectCheckpointPolicy(action.projectId, safePolicy);
      if (!isCurrentAction(action)) return;
      const persisted: unknown = (meta as { checkpoints?: unknown }).checkpoints;
      applyLoadedPolicy(persisted === undefined ? safePolicy : persisted);
      toast.success("Checkpoint policy reset.");
    } catch (error) {
      if (!isCurrentAction(action)) return;
      void logError("reset checkpoint policy", error);
      const detail =
        error instanceof Error ? error.message : typeof error === "string" ? error : "";
      setPolicyError(detail || "Couldn't reset this project's checkpoint policy.");
    } finally {
      if (isCurrentAction(action)) setPolicySaving(false);
    }
  };

  const archivePasswordIsValid = () => {
    if (Array.from(password).length >= 8) return true;
    setPasswordError("Password needs at least 8 characters.");
    return false;
  };

  const exportArchive = async () => {
    if (!projectId || checkpointCount === 0 || !archivePasswordIsValid()) return;
    const action = beginAction(projectId);
    if (!action || !isCurrentAction(action)) return;
    const archivePassword = password;
    const dest = await pickSavePath({
      defaultPath: `${safeArchiveName(projectName || "project")}-checkpoints.oleafly-checkpoints`,
      filters: [{ name: "Oleafly checkpoint archive", extensions: ["oleafly-checkpoints"] }],
    });
    if (!dest || !isCurrentAction(action)) return;
    setBusyAction("export");
    try {
      await checkpointExport(action.projectId, dest, archivePassword);
      if (!isCurrentAction(action)) return;
      setPassword("");
      setPasswordError(null);
      toast.success("Checkpoint archive exported.");
    } catch (error) {
      if (!isCurrentAction(action)) return;
      notifyError("export checkpoints", error, "Couldn't export the checkpoint archive.");
    } finally {
      if (isCurrentAction(action)) setBusyAction(null);
    }
  };

  const importArchive = async () => {
    if (!projectId || !archivePasswordIsValid()) return;
    const action = beginAction(projectId);
    if (!action || !isCurrentAction(action)) return;
    const archivePassword = password;
    const source = await pickOpenPath({
      multiple: false,
      directory: false,
      filters: [{ name: "Oleafly checkpoint archive", extensions: ["oleafly-checkpoints"] }],
    });
    if (typeof source !== "string" || !isCurrentAction(action)) return;
    setBusyAction("import");
    try {
      await checkpointImport(action.projectId, source, archivePassword);
      if (!isCurrentAction(action)) return;
      setPassword("");
      setPasswordError(null);
      await refresh(action.projectId, false, action.session);
      if (!isCurrentAction(action)) return;
      toast.success("Checkpoint archive imported.");
    } catch (error) {
      if (!isCurrentAction(action)) return;
      notifyError("import checkpoints", error, "Couldn't import the checkpoint archive.");
    } finally {
      if (isCurrentAction(action)) setBusyAction(null);
    }
  };

  const visibleCheckpoints = renderIdentityChanged ? [] : checkpoints;
  const visibleStats = renderIdentityChanged ? null : stats;
  const visibleLoading = Boolean(projectId) && (renderIdentityChanged || loading);
  const checkpointCount = visibleStats?.checkpoint_count ?? visibleCheckpoints.length;
  const policyDirty = Boolean(
    savedPolicy &&
      (savedPolicy.mode !== "engine_dependencies" ||
        alwaysInclude !== savedPolicy.always_include.join("\n") ||
        ignored !== savedPolicy.ignored.join("\n")),
  );
  const busy = busyAction !== null || policySaving;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close checkpoints"
        className="absolute inset-0"
        onMouseDown={onBackdropMouseDown}
      />
      <div
        role="dialog"
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="checkpoints-title"
        className="relative flex h-[min(42rem,88vh)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl"
      >
        <header className="flex items-start gap-3 px-4 py-4">
          <span
            aria-hidden
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
          >
            <History className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="checkpoints-title" className="text-base font-semibold">
              Checkpoints
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Validated source snapshots from successful compiles.
            </p>
          </div>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            Source only
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Close checkpoints"
            disabled={busy}
            onClick={close}
          >
            <X className="size-4" />
          </Button>
        </header>

        {visibleStats ? <StoreSummary stats={visibleStats} /> : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {!projectId ? (
            <div className="flex min-h-44 flex-col items-center justify-center text-center">
              <ArchiveRestore className="size-7 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">Open a project to view its checkpoints.</p>
            </div>
          ) : visibleLoading ? (
            <div className="flex min-h-44 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" />
              Loading checkpoints…
            </div>
          ) : loadError ? (
            <div className="flex min-h-44 flex-col items-center justify-center text-center" role="alert">
              <p className="text-sm text-destructive">{loadError}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void refresh(projectId, true, sessionRequest.current)}
              >
                Try again
              </Button>
            </div>
          ) : visibleCheckpoints.length === 0 ? (
            <div className="flex min-h-44 flex-col items-center justify-center text-center">
              <ShieldCheck className="size-7 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">No checkpoints yet</p>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                A checkpoint appears after a successful compile when Oleafly can verify every source dependency.
              </p>
            </div>
          ) : (
            <ul className="list-none space-y-2 p-0" aria-label="Project checkpoints">
              {visibleCheckpoints.map((checkpoint) => (
                <CheckpointRow
                  key={checkpoint.snapshot_root}
                  checkpoint={checkpoint}
                  busy={busy}
                  confirmation={confirmation}
                  onConfirm={setConfirmation}
                  onRestore={(value) => void restore(value)}
                  onDelete={(value) => void deleteCheckpoint(value)}
                />
              ))}
            </ul>
          )}

          {projectId && !visibleLoading ? (
            <section className="mt-5 border-t pt-4" aria-labelledby="checkpoint-storage-title">
              <div className="flex items-start gap-3">
                <Database className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <h3 id="checkpoint-storage-title" className="text-sm font-medium">
                    Storage
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Checkpoints are stored outside the project and version control.
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || checkpointCount <= 1}
                    onClick={() => setConfirmation({ kind: "keep-latest" })}
                  >
                    Keep latest
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={busy || checkpointCount === 0}
                    onClick={() => setConfirmation({ kind: "reset" })}
                  >
                    Reset
                  </Button>
                </div>
              </div>

              {confirmation?.kind === "keep-latest" ? (
                <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs" role="status">
                  <p>Delete every checkpoint except the latest one? This cannot be undone.</p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      autoFocus
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() => void keepLatest()}
                    >
                      Delete older checkpoints
                    </Button>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmation(null)}>
                      Keep all checkpoints
                    </Button>
                  </div>
                </div>
              ) : null}

              {confirmation?.kind === "reset" ? (
                <div className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs" role="status">
                  <p>
                    Delete all checkpoints for this project? Current project files stay unchanged. This cannot be undone.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      autoFocus
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() => void reset()}
                    >
                      Delete all checkpoints
                    </Button>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmation(null)}>
                      Keep checkpoints
                    </Button>
                  </div>
                </div>
              ) : null}

              <section className="mt-4 rounded-lg border p-3" aria-labelledby="checkpoint-policy-title">
                <div className="flex items-start gap-3">
                  <FileCog className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <h3 id="checkpoint-policy-title" className="text-sm font-medium">
                      Project policy
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Choose which project files can be added to a checkpoint.
                    </p>
                  </div>
                </div>

                {policyLoading ? (
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground" role="status">
                    <Loader2 className="size-3.5 animate-spin" />
                    Loading project policy…
                  </div>
                ) : savedPolicy ? (
                  <div className="mt-3 space-y-3">
                    <div>
                      <span className="text-xs font-medium">Mode</span>
                      <div className="mt-1 rounded-md border bg-muted/35 px-2.5 py-1.5 font-mono text-xs">
                        engine_dependencies
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor="checkpoint-always-include" className="text-xs font-medium">
                          Always include
                        </label>
                        <Textarea
                          id="checkpoint-always-include"
                          value={alwaysInclude}
                          disabled={busy}
                          placeholder="figures/*.png"
                          className="mt-1 min-h-20 font-mono text-xs"
                          onChange={(event) => {
                            setAlwaysInclude(event.target.value);
                            setPolicyError(null);
                          }}
                        />
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Add files even when the engine does not report them.
                        </p>
                      </div>
                      <div>
                        <label htmlFor="checkpoint-ignored" className="text-xs font-medium">
                          Ignored
                        </label>
                        <Textarea
                          id="checkpoint-ignored"
                          value={ignored}
                          disabled={busy}
                          placeholder="scratch/*.tmp"
                          className="mt-1 min-h-20 font-mono text-xs"
                          onChange={(event) => {
                            setIgnored(event.target.value);
                            setPolicyError(null);
                          }}
                        />
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Needed files still stop checkpoint creation.
                        </p>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Enter one relative pattern per line. Use forward slashes with * and ?.
                    </p>
                    {policyError ? (
                      <p className="text-xs text-destructive" role="alert">
                        {policyError}
                      </p>
                    ) : null}
                    <div className="flex items-center gap-2">
                      <Button size="sm" disabled={busy || !policyDirty} onClick={() => void savePolicy()}>
                        {policySaving ? <Loader2 className="size-3.5 animate-spin" /> : null}
                        Save policy
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy || !policyDirty}
                        onClick={discardPolicyChanges}
                      >
                        Discard changes
                      </Button>
                    </div>
                  </div>
                ) : policyIssue ? (
                  <div className="mt-3 space-y-3">
                    <p className="text-xs text-foreground" role="status">
                      {policyIssue.kind === "unsupported"
                        ? "This project uses a checkpoint policy this version of Oleafly does not support."
                        : "This project's checkpoint policy is malformed and cannot be edited safely."}
                    </p>
                    <section
                      aria-label="Stored checkpoint policy"
                      className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/35 p-2.5 text-[11px]"
                    >
                      <pre>{policyIssue.preview}</pre>
                    </section>
                    <p className="text-[11px] text-muted-foreground">
                      Resetting replaces the stored policy with the safe engine dependency policy.
                    </p>
                    {policyError ? (
                      <p className="text-xs text-destructive" role="alert">
                        {policyError}
                      </p>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void resetToSafePolicy()}
                    >
                      {policySaving ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      Reset to safe policy
                    </Button>
                  </div>
                ) : (
                  <div className="mt-3">
                    <p className="text-xs text-destructive" role="alert">
                      {policyError || "Couldn't load this project's checkpoint policy."}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() =>
                        void loadPolicy(projectId, sessionRequest.current)
                      }
                    >
                      Try again
                    </Button>
                  </div>
                )}
              </section>

              <div className="mt-4 rounded-lg bg-muted/35 p-3">
                <div className="flex items-start gap-3">
                  <ArchiveRestore className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-medium">Portable archive</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Export or import an encrypted checkpoint archive.
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
                  <div>
                    <label htmlFor="checkpoint-archive-password" className="text-xs font-medium">
                      Archive password
                    </label>
                    <Input
                      id="checkpoint-archive-password"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      value={password}
                      disabled={busy}
                      aria-invalid={Boolean(passwordError)}
                      aria-describedby="checkpoint-password-help"
                      onChange={(event) => {
                        const next = event.target.value;
                        setPassword(next);
                        if (Array.from(next).length >= 8) setPasswordError(null);
                      }}
                      className="mt-1 h-8"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || checkpointCount === 0}
                    onClick={() => void exportArchive()}
                  >
                    {busyAction === "export" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Download className="size-3.5" />
                    )}
                    Export
                  </Button>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void importArchive()}>
                    {busyAction === "import" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <FileUp className="size-3.5" />
                    )}
                    Import
                  </Button>
                </div>
                <p
                  id="checkpoint-password-help"
                  className={`mt-1.5 text-[11px] ${passwordError ? "text-destructive" : "text-muted-foreground"}`}
                  role={passwordError ? "alert" : undefined}
                >
                  {passwordError || "Use at least 8 characters. Oleafly does not save this password."}
                </p>
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
