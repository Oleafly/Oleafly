import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArchiveRestore,
  Check,
  ChevronRight,
  Copy,
  Download,
  FileUp,
  FolderOpen,
  Loader2,
  Pencil,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import {
  checkpointDelete,
  checkpointEngineLabel,
  checkpointExport,
  checkpointFiles,
  checkpointImport,
  checkpointInspect,
  checkpointKeepLatest,
  checkpointList,
  checkpointReset,
  checkpointRestore,
  checkpointRevealStore,
  checkpointSetLabel,
  checkpointStats,
  type CheckpointFileSummary,
  type CheckpointStoreInspection,
  type CheckpointStoreStats,
  type CheckpointSummary,
} from "@/lib/checkpoints";
import { logError } from "@/lib/log";
import { pickOpenPath, pickSavePath } from "@/lib/native-file-dialog";
import { notifyError, toast } from "@/lib/toast";
import { cn, isMac, isWindows } from "@/lib/utils";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

type Confirmation =
  | { kind: "restore" | "delete"; snapshotRoot: string }
  | { kind: "keep-latest" | "reset" }
  | null;

type FileState =
  | { status: "loading" }
  | { status: "ready"; files: CheckpointFileSummary[] }
  | { status: "error" };

type PanelActionToken = {
  projectId: string;
  session: number;
  request: number;
};

const REVEAL_LABEL = isWindows
  ? "Show in Explorer"
  : isMac
    ? "Show in Finder"
    : "Show in file manager";

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000_000],
  ["month", 2_592_000_000],
  ["week", 604_800_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

function checkpointsTabIsActive(): boolean {
  const settings = useSettingsStore.getState();
  return settings.versioningOpen && settings.versioningTab === "checkpoints";
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

function formatRelativeTime(value: number, now: number): string {
  if (!Number.isFinite(value)) return "Time not recorded";
  const elapsed = now - value;
  if (elapsed < 60_000) return "Just now";
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, span] of RELATIVE_UNITS) {
    if (elapsed >= span) return formatter.format(-Math.round(elapsed / span), unit);
  }
  return "Just now";
}

function isoTimestamp(value: number): string | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function shortRoot(snapshotRoot: string): string {
  return snapshotRoot.slice(0, 8);
}

function safeArchiveName(name: string): string {
  const safe = name.trim().replace(/[^\w.-]+/g, "_").replace(/^\.+|\.+$/g, "");
  return safe || "project";
}

function unstoredSentence(count: number): string {
  return count === 1
    ? "1 file was not stored, so it stays as it is on disk."
    : `${count} files were not stored, so they stay as they are on disk.`;
}

function AdvancedCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const headingId = `checkpoints-advanced-${title.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-xl border bg-card/60">
      <div className="border-b px-4 py-3">
        <h3 id={headingId} className="text-sm font-medium">
          {title}
        </h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-3 px-4 py-4 text-sm">{children}</div>
    </section>
  );
}

function StoreSummary({ stats }: { stats: CheckpointStoreStats }) {
  const items = [
    { label: "Checkpoints", value: stats.checkpoint_count.toLocaleString() },
    { label: "Stored", value: formatBytes(stats.stored_pack_bytes) },
    { label: "Source size", value: formatBytes(stats.logical_bytes) },
    { label: "Reclaimable", value: formatBytes(stats.reclaimable_bytes) },
  ];

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-[11px] text-muted-foreground">{item.label}</dt>
          <dd className="truncate text-sm font-medium tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CatalogFacts({ inspection }: { inspection: CheckpointStoreInspection }) {
  const counts = inspection.table_counts;
  const facts: [string, string][] = [
    ["Format version", inspection.format_version.toLocaleString()],
    ["Lineage", inspection.lineage || "Not recorded"],
    ["Catalog file", inspection.catalog_path || "Not created yet"],
    ["Checkpoints", counts.checkpoints.toLocaleString()],
    ["Manifests", counts.manifests.toLocaleString()],
    ["Packs", counts.packs.toLocaleString()],
    ["Chunks", counts.chunks.toLocaleString()],
    ["Manifest chunks", counts.manifest_chunks.toLocaleString()],
  ];
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
      {facts.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="min-w-0 break-all font-mono">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PackTable({ inspection }: { inspection: CheckpointStoreInspection }) {
  if (inspection.packs.length === 0) {
    return <p className="text-xs text-muted-foreground">No packs written yet.</p>;
  }
  return (
    <table className="w-full text-left text-xs">
      <caption className="sr-only">Checkpoint store packs</caption>
      <thead className="text-muted-foreground">
        <tr>
          <th scope="col" className="py-1 font-medium">
            Pack
          </th>
          <th scope="col" className="py-1 text-right font-medium">
            Size
          </th>
          <th scope="col" className="py-1 text-right font-medium">
            Chunks
          </th>
        </tr>
      </thead>
      <tbody>
        {inspection.packs.map((pack) => (
          <tr key={pack.file_name} className="border-t">
            <td className="py-1 pr-2 font-mono">{pack.file_name}</td>
            <td className="py-1 text-right tabular-nums">{formatBytes(pack.bytes)}</td>
            <td className="py-1 text-right tabular-nums">{pack.chunk_count.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CheckpointFileRows({ state }: { state: FileState | undefined }) {
  if (!state || state.status === "loading") {
    return (
      <p className="flex items-center gap-2 py-1 text-[11px] text-muted-foreground" role="status">
        <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
        Loading files.
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <p className="py-1 text-[11px] text-destructive" role="alert">
        Couldn't load the files in this checkpoint.
      </p>
    );
  }
  if (state.files.length === 0) {
    return <p className="py-1 text-[11px] text-muted-foreground">No files recorded.</p>;
  }
  return (
    <ul className="list-none space-y-1 p-0">
      {state.files.map((file) => (
        <li key={file.path} className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="min-w-0 break-all font-mono">{file.path}</span>
          <span className="text-muted-foreground">{formatBytes(file.bytes)}</span>
          {file.stored ? null : (
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              Not stored
            </Badge>
          )}
        </li>
      ))}
    </ul>
  );
}

interface FileListProps {
  id: string;
  label: string;
  state: FileState | undefined;
  onRetry: () => void;
}

function FileList({ id, label, state, onRetry }: Readonly<FileListProps>) {
  if (!state || state.status === "loading") {
    return (
      <div
        id={id}
        role="status"
        className="mt-2 flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
      >
        <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        Loading files.
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div id={id} className="mt-2 rounded-md border bg-muted/20 px-3 py-2 text-xs">
        <p className="text-destructive" role="alert">
          Couldn't load the files in this checkpoint.
        </p>
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  if (state.files.length === 0) {
    return (
      <p id={id} className="mt-2 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        This checkpoint recorded no files.
      </p>
    );
  }

  return (
    <ul id={id} aria-label={`Files in ${label}`} className="mt-2 list-none rounded-md border bg-muted/20 p-0">
      {state.files.map((file) => (
        <li
          key={file.path}
          data-testid="checkpoint-file"
          data-path={file.path}
          className="flex items-start gap-3 border-b px-3 py-2 last:border-b-0"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate font-mono text-xs" title={file.path}>
                {file.path}
              </span>
              {file.stored ? null : (
                <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                  Not stored
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{formatBytes(file.bytes)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

interface TimelineEntryProps {
  checkpoint: CheckpointSummary;
  version: string;
  now: number;
  busy: boolean;
  expanded: boolean;
  confirmation: Confirmation;
  fileState: FileState | undefined;
  copied: boolean;
  editingLabel: boolean;
  labelDraft: string;
  savingLabel: boolean;
  onToggleFiles: () => void;
  onConfirm: (confirmation: Confirmation) => void;
  onRestore: () => void;
  onDelete: () => void;
  onCopyRoot: () => void;
  onRetryFiles: () => void;
  onStartLabelEdit: () => void;
  onLabelDraftChange: (value: string) => void;
  onSaveLabel: () => void;
  onCancelLabel: () => void;
  onRemoveLabel: () => void;
}

function TimelineEntry({
  checkpoint,
  version,
  now,
  busy,
  expanded,
  confirmation,
  fileState,
  copied,
  editingLabel,
  labelDraft,
  savingLabel,
  onToggleFiles,
  onConfirm,
  onRestore,
  onDelete,
  onCopyRoot,
  onRetryFiles,
  onStartLabelEdit,
  onLabelDraftChange,
  onSaveLabel,
  onCancelLabel,
  onRemoveLabel,
}: TimelineEntryProps) {
  const root = checkpoint.snapshot_root;
  const label = checkpoint.label?.trim() ? checkpoint.label.trim() : null;
  const title = label ?? version;
  const restoring = confirmation?.kind === "restore" && confirmation.snapshotRoot === root;
  const deleting = confirmation?.kind === "delete" && confirmation.snapshotRoot === root;
  const filesId = `checkpoint-files-${root}`;
  const unstored =
    fileState?.status === "ready" ? fileState.files.filter((file) => !file.stored).length : 0;

  return (
    <li
      data-testid="checkpoint-entry"
      data-version={version}
      data-root={root}
      data-label={label ?? undefined}
      className="group relative rounded-md py-3 pl-10 pr-2 hover:bg-accent/60"
    >
      <span
        aria-hidden
        className="absolute left-[14px] top-[18px] z-10 size-2.5 rounded-full border-2 border-popover bg-primary ring-1 ring-primary/35"
      />
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {editingLabel ? (
              <>
                <Input
                  autoFocus
                  aria-label="Checkpoint label"
                  data-modal-escape-inner=""
                  maxLength={80}
                  value={labelDraft}
                  disabled={savingLabel}
                  placeholder="Name this checkpoint"
                  className="h-7 w-48 text-sm"
                  onChange={(event) => onLabelDraftChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      onSaveLabel();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      onCancelLabel();
                    }
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="Save label"
                  disabled={savingLabel}
                  onClick={onSaveLabel}
                >
                  <Check className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="Cancel label editing"
                  disabled={savingLabel}
                  onClick={onCancelLabel}
                >
                  <X className="size-3.5" />
                </Button>
              </>
            ) : (
              <>
                <span className="min-w-0 truncate text-sm font-medium tabular-nums">
                  {title}
                </span>
                {label ? (
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px] tabular-nums">
                    {version}
                  </Badge>
                ) : null}
                <Tooltip label="Edit label" side="top">
                  <button
                    type="button"
                    aria-label={`Edit label for ${version}`}
                    disabled={busy}
                    onClick={onStartLabelEdit}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Pencil className="size-3" />
                  </button>
                </Tooltip>
                {label ? (
                  <Tooltip label="Remove label" side="top">
                    <button
                      type="button"
                      aria-label={`Remove label ${label}`}
                      disabled={busy}
                      onClick={onRemoveLabel}
                      className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <X className="size-3" />
                    </button>
                  </Tooltip>
                ) : null}
                <time
                  dateTime={isoTimestamp(checkpoint.completed_at_unix_ms)}
                  className="text-xs text-muted-foreground"
                >
                  {formatRelativeTime(checkpoint.completed_at_unix_ms, now)}
                </time>
              </>
            )}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {checkpoint.engine ? checkpointEngineLabel(checkpoint.engine) : "Unknown engine"} ·{" "}
            {checkpoint.main_document || "Main document not recorded"}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>{formatCompletedAt(checkpoint.completed_at_unix_ms)}</span>
            <span aria-hidden>·</span>
            <span>
              {checkpoint.file_count.toLocaleString()}{" "}
              {checkpoint.file_count === 1 ? "file" : "files"}
            </span>
            <span aria-hidden>·</span>
            <span>{formatBytes(checkpoint.logical_bytes)}</span>
            {root ? (
              <>
                <span aria-hidden>·</span>
                <Tooltip
                  label={copied ? "Checkpoint id copied" : "Copy full checkpoint id"}
                  side="top"
                >
                  <button
                    type="button"
                    aria-label={`Copy checkpoint id ${shortRoot(root)}`}
                    onClick={onCopyRoot}
                    className="inline-flex items-center gap-1 rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-foreground/80 hover:border-primary/40 hover:bg-accent hover:text-foreground"
                  >
                    {shortRoot(root)}
                    {copied ? (
                      <Check className="size-2.5 text-emerald-500" />
                    ) : (
                      <Copy className="size-2.5 opacity-60" />
                    )}
                  </button>
                </Tooltip>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {restoring ? (
            <>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={onRestore}
                title={`Overwrite your current copies with the files in ${version}. Files added since are left in place.`}
              >
                Restore files
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => onConfirm(null)}>
                Cancel
              </Button>
            </>
          ) : deleting ? (
            <>
              <Button
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={onDelete}
                title={`Delete ${version} permanently`}
              >
                Delete checkpoint
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => onConfirm(null)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Restore ${version}`}
                disabled={busy}
                onClick={() => onConfirm({ kind: "restore", snapshotRoot: root })}
              >
                <RotateCcw className="size-3.5" />
                Restore
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label={`Delete ${version}`}
                disabled={busy}
                onClick={() => onConfirm({ kind: "delete", snapshotRoot: root })}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {restoring && unstored > 0 ? (
        <p className="mt-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs" role="status">
          {unstoredSentence(unstored)}
        </p>
      ) : null}

      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={expanded ? filesId : undefined}
        aria-label={`${expanded ? "Hide" : "Show"} files for ${version}`}
        onClick={onToggleFiles}
        className="mt-1.5 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronRight
          aria-hidden
          className={cn("size-3 transition-transform", expanded && "rotate-90")}
        />
        {expanded ? "Hide files" : "Show files"}
      </button>

      {expanded ? (
        <FileList id={filesId} label={version} state={fileState} onRetry={onRetryFiles} />
      ) : null}
    </li>
  );
}

export function CheckpointsPanel({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const open = useSettingsStore(
    (state) => state.versioningOpen && state.versioningTab === "checkpoints",
  );
  const closeVersioning = useSettingsStore((state) => state.closeVersioning);
  const checkpointsRevision = useSettingsStore((state) => state.checkpointsRevision);
  const publishingProjectId = useSettingsStore((state) => state.checkpointPublishingProjectId);
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
  const [expanded, setExpanded] = useState<string[]>([]);
  const [fileStates, setFileStates] = useState<Record<string, FileState>>({});
  const [copiedRoot, setCopiedRoot] = useState<string | null>(null);
  const [editingLabelRoot, setEditingLabelRoot] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [inspection, setInspection] = useState<CheckpointStoreInspection | null>(null);
  const [inspectionLoading, setInspectionLoading] = useState(false);
  const [inspectionError, setInspectionError] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogExpanded, setCatalogExpanded] = useState<string[]>([]);
  const loadRequest = useRef(0);
  const inspectRequest = useRef(0);
  const sessionRequest = useRef(0);
  const actionRequest = useRef(0);
  const fileRequests = useRef(new Map<string, number>());
  const copyTimer = useRef<number | null>(null);
  const seenRevision = useRef(checkpointsRevision);
  const renderedIdentity = useRef({ open, projectId });
  const renderIdentityChanged =
    renderedIdentity.current.open !== open || renderedIdentity.current.projectId !== projectId;
  const busy = busyAction !== null;

  const isCurrentSession = useCallback(
    (targetProjectId: string | null, session: number) =>
      session === sessionRequest.current &&
      useFilesStore.getState().projectId === targetProjectId &&
      checkpointsTabIsActive(),
    [],
  );

  const beginAction = useCallback(
    (targetProjectId: string): PanelActionToken | null => {
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
    (token: PanelActionToken) =>
      token.request === actionRequest.current && isCurrentSession(token.projectId, token.session),
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
        if (request !== loadRequest.current || !isCurrentSession(targetProjectId, session)) return;
        setCheckpoints(nextCheckpoints);
        setStats(nextStats);
      } catch (error) {
        if (request !== loadRequest.current || !isCurrentSession(targetProjectId, session)) return;
        void logError("load checkpoints", error);
        setLoadError("Couldn't load checkpoints. Try again.");
      } finally {
        if (request === loadRequest.current && isCurrentSession(targetProjectId, session)) {
          setLoading(false);
        }
      }
    },
    [isCurrentSession],
  );

  const loadInspection = useCallback(
    (targetProjectId: string | null, session: number) => {
      const request = ++inspectRequest.current;
      setInspection(null);
      setInspectionError(null);
      if (!targetProjectId) {
        setInspectionLoading(false);
        return;
      }
      const stillCurrent = () =>
        request === inspectRequest.current && isCurrentSession(targetProjectId, session);
      setInspectionLoading(true);
      void checkpointInspect(targetProjectId)
        .then((next) => {
          if (!stillCurrent()) return;
          setInspection(next);
        })
        .catch(() => {
          if (!stillCurrent()) return;
          setInspectionError("Couldn't read this project's checkpoint store.");
        })
        .finally(() => {
          if (stillCurrent()) setInspectionLoading(false);
        });
    },
    [isCurrentSession],
  );

  const loadFiles = useCallback(
    async (targetProjectId: string, snapshotRoot: string, session: number) => {
      if (!isCurrentSession(targetProjectId, session)) return;
      const request = (fileRequests.current.get(snapshotRoot) ?? 0) + 1;
      fileRequests.current.set(snapshotRoot, request);
      const stillCurrent = () =>
        request === fileRequests.current.get(snapshotRoot) &&
        isCurrentSession(targetProjectId, session);
      setFileStates((current) => ({ ...current, [snapshotRoot]: { status: "loading" } }));
      try {
        const files = await checkpointFiles(targetProjectId, snapshotRoot);
        if (!stillCurrent()) return;
        setFileStates((current) => ({
          ...current,
          [snapshotRoot]: { status: "ready", files },
        }));
      } catch (error) {
        if (!stillCurrent()) return;
        void logError("load checkpoint files", error);
        setFileStates((current) => ({ ...current, [snapshotRoot]: { status: "error" } }));
      }
    },
    [isCurrentSession],
  );

  useLayoutEffect(() => {
    renderedIdentity.current = { open, projectId };
    const session = ++sessionRequest.current;
    actionRequest.current += 1;
    loadRequest.current += 1;
    inspectRequest.current += 1;
    fileRequests.current.clear();
    if (copyTimer.current !== null) {
      window.clearTimeout(copyTimer.current);
      copyTimer.current = null;
    }
    setBusyAction(null);
    setConfirmation(null);
    setPassword("");
    setPasswordError(null);
    setExpanded([]);
    setFileStates({});
    setCopiedRoot(null);
    setEditingLabelRoot(null);
    setLabelDraft("");
    setAdvancedOpen(false);
    setCatalogOpen(false);
    setCatalogExpanded([]);
    setInspection(null);
    setInspectionError(null);
    setInspectionLoading(false);
    if (!open) {
      setLoading(false);
      return;
    }
    setCheckpoints([]);
    setStats(null);
    void refresh(projectId, true, session);
    return () => {
      sessionRequest.current += 1;
      actionRequest.current += 1;
      loadRequest.current += 1;
      inspectRequest.current += 1;
      fileRequests.current.clear();
      if (copyTimer.current !== null) {
        window.clearTimeout(copyTimer.current);
        copyTimer.current = null;
      }
    };
  }, [open, projectId, refresh]);

  useEffect(() => {
    if (seenRevision.current === checkpointsRevision) return;
    seenRevision.current = checkpointsRevision;
    if (!open || !projectId) return;
    void refresh(projectId, false, sessionRequest.current);
    if (advancedOpen) loadInspection(projectId, sessionRequest.current);
  }, [checkpointsRevision, open, projectId, refresh, advancedOpen, loadInspection]);

  useEffect(() => {
    if (!open || !advancedOpen) return;
    loadInspection(projectId, sessionRequest.current);
  }, [open, advancedOpen, projectId, loadInspection]);

  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  const visibleCheckpoints = renderIdentityChanged ? [] : checkpoints;
  const versionLabels = useMemo(() => {
    const labels = new Map<string, string>();
    [...visibleCheckpoints].reverse().forEach((entry, index) => {
      labels.set(entry.snapshot_root, `V${index + 1}`);
    });
    return labels;
  }, [visibleCheckpoints]);

  if (!open) return null;

  const visibleStats = renderIdentityChanged ? null : stats;
  const visibleInspection = renderIdentityChanged ? null : inspection;
  const visibleLoading = Boolean(projectId) && (renderIdentityChanged || loading);
  const checkpointCount = visibleStats?.checkpoint_count ?? visibleCheckpoints.length;
  const publishing = Boolean(projectId) && publishingProjectId === projectId;
  const now = Date.now();
  const storePath = visibleInspection?.store_path ?? null;
  const packBytes =
    visibleInspection?.packs.reduce((total, pack) => total + pack.bytes, 0) ?? 0;
  const labelFor = (snapshotRoot: string) => versionLabels.get(snapshotRoot) ?? "Checkpoint";

  const ensureFiles = (snapshotRoot: string) => {
    if (!projectId) return;
    if (fileStates[snapshotRoot]?.status === "ready") return;
    void loadFiles(projectId, snapshotRoot, sessionRequest.current);
  };

  const toggleFiles = (snapshotRoot: string) => {
    const willExpand = !expanded.includes(snapshotRoot);
    setExpanded((current) =>
      willExpand
        ? [...current, snapshotRoot]
        : current.filter((entry) => entry !== snapshotRoot),
    );
    if (willExpand) ensureFiles(snapshotRoot);
  };

  const toggleCatalogFiles = (snapshotRoot: string) => {
    const willExpand = !catalogExpanded.includes(snapshotRoot);
    setCatalogExpanded((current) =>
      willExpand
        ? [...current, snapshotRoot]
        : current.filter((entry) => entry !== snapshotRoot),
    );
    if (willExpand) ensureFiles(snapshotRoot);
  };

  const confirm = (next: Confirmation) => {
    setConfirmation(next);
    if (next?.kind === "restore") ensureFiles(next.snapshotRoot);
  };

  const copyRoot = async (snapshotRoot: string) => {
    try {
      await navigator.clipboard.writeText(snapshotRoot);
      setCopiedRoot(snapshotRoot);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => {
        copyTimer.current = null;
        setCopiedRoot((current) => (current === snapshotRoot ? null : current));
      }, 1500);
    } catch (error) {
      notifyError("copy checkpoint id", error, "Couldn't copy that checkpoint id.");
    }
  };

  const startLabelEdit = (checkpoint: CheckpointSummary) => {
    setEditingLabelRoot(checkpoint.snapshot_root);
    setLabelDraft(checkpoint.label ?? "");
  };

  const cancelLabelEdit = () => {
    setEditingLabelRoot(null);
    setLabelDraft("");
  };

  const saveLabel = async (snapshotRoot: string, value: string) => {
    if (!projectId) return;
    const action = beginAction(projectId);
    if (!action || !isCurrentAction(action)) return;
    setBusyAction(`label:${snapshotRoot}`);
    try {
      const updated = await checkpointSetLabel(action.projectId, snapshotRoot, value.trim());
      if (!isCurrentAction(action)) return;
      setCheckpoints((current) =>
        current.map((entry) =>
          entry.snapshot_root === updated.snapshot_root ? updated : entry,
        ),
      );
      if (editingLabelRoot === snapshotRoot) {
        setEditingLabelRoot(null);
        setLabelDraft("");
      }
    } catch (error) {
      if (!isCurrentAction(action)) return;
      notifyError("save checkpoint label", error, "Couldn't save the checkpoint label.");
    } finally {
      if (isCurrentAction(action)) setBusyAction(null);
    }
  };

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
      await useFilesStore.getState().applyProjectStateChanged(event);
      if (!isCurrentAction(action)) return;
      toast.success("Checkpoint restored.");
      closeVersioning();
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
      if (advancedOpen) loadInspection(action.projectId, action.session);
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
      if (advancedOpen) loadInspection(action.projectId, action.session);
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
      if (advancedOpen) loadInspection(action.projectId, action.session);
    } catch (error) {
      if (!isCurrentAction(action)) return;
      notifyError("reset checkpoints", error, "Couldn't reset checkpoints.");
    } finally {
      if (isCurrentAction(action)) setBusyAction(null);
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
      if (advancedOpen) loadInspection(action.projectId, action.session);
    } catch (error) {
      if (!isCurrentAction(action)) return;
      notifyError("import checkpoints", error, "Couldn't import the checkpoint archive.");
    } finally {
      if (isCurrentAction(action)) setBusyAction(null);
    }
  };

  const railVisible = visibleCheckpoints.length + (publishing ? 1 : 0) > 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pb-3">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          One version per successful compile that changed the source.
        </p>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
          Source only
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {!projectId ? (
          <div className="flex min-h-44 flex-col items-center justify-center text-center">
            <ArchiveRestore className="size-7 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">Open a project to view its checkpoints.</p>
          </div>
        ) : visibleLoading ? (
          <div
            className="flex min-h-44 items-center justify-center gap-2 text-sm text-muted-foreground"
            role="status"
          >
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
            Loading checkpoints.
          </div>
        ) : loadError ? (
          <div
            className="flex min-h-44 flex-col items-center justify-center text-center"
            role="alert"
          >
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
        ) : visibleCheckpoints.length === 0 && !publishing ? (
          <div className="flex min-h-44 flex-col items-center justify-center text-center">
            <ShieldCheck className="size-7 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">No checkpoints yet</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              A checkpoint appears after a successful compile, when the project has changed
              since the last one.
            </p>
          </div>
        ) : (
          <ol
            data-testid="checkpoint-timeline"
            aria-label="Project checkpoints"
            className="relative list-none p-0"
          >
            {railVisible ? (
              <span
                data-testid="checkpoint-rail"
                aria-hidden
                className="absolute bottom-6 left-[18px] top-6 w-px bg-primary/40"
              />
            ) : null}
            {publishing ? (
              <li data-testid="checkpoint-publishing" className="relative py-3 pl-10 pr-2">
                <span
                  aria-hidden
                  className="absolute left-[14px] top-[18px] z-10 size-2.5 rounded-full border-2 border-dashed border-primary/60 bg-popover"
                />
                <span
                  role="status"
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <Loader2
                    className="size-3.5 animate-spin motion-reduce:animate-none"
                    aria-hidden
                  />
                  Saving a checkpoint from the latest compile.
                </span>
              </li>
            ) : null}
            {visibleCheckpoints.map((checkpoint) => (
              <TimelineEntry
                key={checkpoint.snapshot_root}
                checkpoint={checkpoint}
                version={labelFor(checkpoint.snapshot_root)}
                now={now}
                busy={busy}
                expanded={expanded.includes(checkpoint.snapshot_root)}
                confirmation={confirmation}
                fileState={fileStates[checkpoint.snapshot_root]}
                copied={copiedRoot === checkpoint.snapshot_root}
                editingLabel={editingLabelRoot === checkpoint.snapshot_root}
                labelDraft={labelDraft}
                savingLabel={busyAction === `label:${checkpoint.snapshot_root}`}
                onToggleFiles={() => toggleFiles(checkpoint.snapshot_root)}
                onConfirm={confirm}
                onRestore={() => void restore(checkpoint)}
                onDelete={() => void deleteCheckpoint(checkpoint)}
                onCopyRoot={() => void copyRoot(checkpoint.snapshot_root)}
                onRetryFiles={() => ensureFiles(checkpoint.snapshot_root)}
                onStartLabelEdit={() => startLabelEdit(checkpoint)}
                onLabelDraftChange={setLabelDraft}
                onSaveLabel={() => void saveLabel(checkpoint.snapshot_root, labelDraft)}
                onCancelLabel={cancelLabelEdit}
                onRemoveLabel={() => void saveLabel(checkpoint.snapshot_root, "")}
              />
            ))}
          </ol>
        )}

        <div className="mt-4 border-t px-2 pt-3">
          <button
            type="button"
            data-testid="checkpoints-advanced"
            aria-expanded={advancedOpen}
            aria-controls={advancedOpen ? "checkpoints-advanced-panel" : undefined}
            onClick={() => {
              if (advancedOpen) {
                setConfirmation((current) =>
                  current && "snapshotRoot" in current ? current : null,
                );
              }
              setAdvancedOpen(!advancedOpen);
            }}
            className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronRight
              aria-hidden
              className={cn("size-3 transition-transform", advancedOpen && "rotate-90")}
            />
            Advanced
          </button>

          {advancedOpen ? (
            <div id="checkpoints-advanced-panel" className="mt-3 space-y-3">
              <AdvancedCard
                title="Overview"
                description="What this project's checkpoint store holds right now."
              >
                {visibleStats ? (
                  <StoreSummary stats={visibleStats} />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {!projectId
                      ? "Open a project to see its checkpoint totals."
                      : (loadError ?? "Checkpoint totals are loading.")}
                  </p>
                )}
              </AdvancedCard>

              <AdvancedCard
                title="Storage"
                description="Checkpoints live outside the project folder and outside version control."
              >
                {!projectId ? (
                  <p className="text-xs text-muted-foreground">
                    Open a project to see where its checkpoints are stored.
                  </p>
                ) : inspectionLoading ? (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                    <Loader2
                      className="size-3.5 animate-spin motion-reduce:animate-none"
                      aria-hidden
                    />
                    Reading the checkpoint store.
                  </p>
                ) : inspectionError ? (
                  <div>
                    <p className="text-xs text-destructive" role="alert">
                      {inspectionError}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() => loadInspection(projectId, sessionRequest.current)}
                    >
                      Try again
                    </Button>
                  </div>
                ) : !storePath ? (
                  <p className="text-xs text-muted-foreground">
                    This project has no checkpoint store yet. One is created with its first
                    checkpoint.
                  </p>
                ) : (
                  <>
                    <div className="flex items-start gap-2">
                      <code className="min-w-0 flex-1 break-all rounded-lg border bg-background p-3 text-xs">
                        {storePath}
                      </code>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void checkpointRevealStore(projectId)}
                      >
                        <FolderOpen className="size-3.5" aria-hidden />
                        {REVEAL_LABEL}
                      </Button>
                    </div>
                    <dl className="grid grid-cols-3 gap-x-4 gap-y-1">
                      <div className="min-w-0">
                        <dt className="text-[11px] text-muted-foreground">Catalog size</dt>
                        <dd className="truncate text-sm font-medium tabular-nums">
                          {formatBytes(visibleInspection?.catalog_bytes ?? 0)}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[11px] text-muted-foreground">Packs</dt>
                        <dd className="truncate text-sm font-medium tabular-nums">
                          {(visibleInspection?.table_counts.packs ?? 0).toLocaleString()}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[11px] text-muted-foreground">Pack size</dt>
                        <dd className="truncate text-sm font-medium tabular-nums">
                          {formatBytes(packBytes)}
                        </dd>
                      </div>
                    </dl>
                  </>
                )}

                <div className="border-t pt-3">
                  <button
                    type="button"
                    aria-expanded={catalogOpen}
                    aria-controls={catalogOpen ? "checkpoint-catalog" : undefined}
                    disabled={!projectId || !visibleInspection}
                    onClick={() => setCatalogOpen((current) => !current)}
                    className="inline-flex items-center gap-1 rounded-md text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    <ChevronRight
                      aria-hidden
                      className={cn("size-3 transition-transform", catalogOpen && "rotate-90")}
                    />
                    Inspect catalog
                  </button>

                  {catalogOpen && visibleInspection ? (
                    <div id="checkpoint-catalog" className="mt-3 space-y-4">
                      <CatalogFacts inspection={visibleInspection} />
                      <PackTable inspection={visibleInspection} />
                      <div>
                        <h4 className="text-xs font-medium">Checkpoints</h4>
                        {visibleCheckpoints.length === 0 ? (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            No checkpoints yet.
                          </p>
                        ) : (
                          <ul className="mt-1 list-none space-y-1 p-0">
                            {visibleCheckpoints.map((checkpoint) => {
                              const version = labelFor(checkpoint.snapshot_root);
                              const isOpen = catalogExpanded.includes(checkpoint.snapshot_root);
                              return (
                                <li key={checkpoint.snapshot_root} className="border-t pt-1">
                                  <button
                                    type="button"
                                    aria-expanded={isOpen}
                                    aria-label={`${isOpen ? "Hide" : "Show"} catalog files for ${version}`}
                                    onClick={() => toggleCatalogFiles(checkpoint.snapshot_root)}
                                    className="flex w-full items-center gap-1.5 rounded-md py-0.5 text-left text-[11px] hover:text-foreground"
                                  >
                                    <ChevronRight
                                      aria-hidden
                                      className={cn(
                                        "size-3 shrink-0 transition-transform",
                                        isOpen && "rotate-90",
                                      )}
                                    />
                                    <span className="font-medium tabular-nums">{version}</span>
                                    <span className="truncate text-muted-foreground">
                                      {formatCompletedAt(checkpoint.completed_at_unix_ms)}
                                    </span>
                                  </button>
                                  {isOpen ? (
                                    <div className="pl-4">
                                      <CheckpointFileRows
                                        state={fileStates[checkpoint.snapshot_root]}
                                      />
                                    </div>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              </AdvancedCard>

              <AdvancedCard
                title="Archive"
                description="Export or import an encrypted copy of this project's checkpoints."
              >
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label
                      htmlFor="checkpoint-archive-password"
                      className="text-[11px] font-medium text-muted-foreground"
                    >
                      Archive password
                    </label>
                    <Input
                      id="checkpoint-archive-password"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      value={password}
                      disabled={busy || !projectId}
                      aria-invalid={Boolean(passwordError)}
                      aria-describedby="checkpoint-password-help"
                      onChange={(event) => {
                        const next = event.target.value;
                        setPassword(next);
                        if (Array.from(next).length >= 8) setPasswordError(null);
                      }}
                      className="mt-1 h-8 w-40"
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !projectId || checkpointCount === 0}
                    onClick={() => void exportArchive()}
                  >
                    {busyAction === "export" ? (
                      <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                    ) : (
                      <Download className="size-3.5" />
                    )}
                    Export
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !projectId}
                    onClick={() => void importArchive()}
                  >
                    {busyAction === "import" ? (
                      <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                    ) : (
                      <FileUp className="size-3.5" />
                    )}
                    Import
                  </Button>
                </div>
                <p
                  id="checkpoint-password-help"
                  className={cn(
                    "text-[11px]",
                    passwordError ? "text-destructive" : "text-muted-foreground",
                  )}
                  role={passwordError ? "alert" : undefined}
                >
                  {passwordError || "Use at least 8 characters. Oleafly does not save this password."}
                </p>
              </AdvancedCard>

              <AdvancedCard
                title="Maintenance"
                description="Delete checkpoints this project no longer needs."
              >
                {confirmation?.kind === "keep-latest" ? (
                  <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs" role="status">
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
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => setConfirmation(null)}
                      >
                        Keep all checkpoints
                      </Button>
                    </div>
                  </div>
                ) : null}

                {confirmation?.kind === "reset" ? (
                  <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs" role="status">
                    <p>
                      Delete all checkpoints for this project? Current project files stay unchanged.
                      This cannot be undone.
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
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => setConfirmation(null)}
                      >
                        Keep checkpoints
                      </Button>
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !projectId || checkpointCount <= 1}
                    onClick={() => setConfirmation({ kind: "keep-latest" })}
                  >
                    Keep latest
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={busy || !projectId || checkpointCount === 0}
                    onClick={() => setConfirmation({ kind: "reset" })}
                  >
                    Reset
                  </Button>
                </div>
              </AdvancedCard>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
