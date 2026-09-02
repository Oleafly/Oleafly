import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, FolderOpen, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import {
  checkpointFiles,
  checkpointInspect,
  checkpointList,
  checkpointRevealStore,
  type CheckpointFileSummary,
  type CheckpointStoreInspection,
  type CheckpointSummary,
} from "@/lib/checkpoints";
import { getConfig, setConfig, type AppConfig } from "@/lib/tauri";
import { isMac, isWindows } from "@/lib/utils";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";

type FileState =
  | { status: "loading" }
  | { status: "ready"; files: CheckpointFileSummary[] }
  | { status: "error" };

const REVEAL_LABEL = isWindows
  ? "Show in Explorer"
  : isMac
    ? "Show in Finder"
    : "Show in file manager";

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

function versionLabels(checkpoints: CheckpointSummary[]): Map<string, string> {
  const labels = new Map<string, string>();
  [...checkpoints].reverse().forEach((entry, index) => {
    labels.set(entry.snapshot_root, `V${index + 1}`);
  });
  return labels;
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const headingId = `checkpoints-${title.toLowerCase().replace(/\s+/g, "-")}-title`;
  return (
    <section aria-labelledby={headingId} className="overflow-hidden rounded-xl border bg-card/60">
      <div className="border-b px-4 py-3">
        <h3 id={headingId} className="font-medium">
          {title}
        </h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-3 px-4 py-4">{children}</div>
    </section>
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

export function CheckpointsSection() {
  const projectId = useFilesStore((state) => state.projectId);
  const setCheckpointsOpen = useSettingsStore((state) => state.setCheckpointsOpen);
  const setSettingsOpen = useSettingsStore((state) => state.setSettingsOpen);
  const [config, setConfigState] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [inspection, setInspection] = useState<CheckpointStoreInspection | null>(null);
  const [inspectionLoading, setInspectionLoading] = useState(false);
  const [inspectionError, setInspectionError] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [checkpoints, setCheckpoints] = useState<CheckpointSummary[] | null>(null);
  const [checkpointsError, setCheckpointsError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [fileStates, setFileStates] = useState<Record<string, FileState>>({});
  const configRequest = useRef(0);
  const inspectRequest = useRef(0);
  const listRequest = useRef(0);

  useEffect(() => {
    const request = ++configRequest.current;
    void getConfig()
      .then((next) => {
        if (request !== configRequest.current) return;
        setConfigState(next);
        setConfigError(null);
      })
      .catch(() => {
        if (request !== configRequest.current) return;
        setConfigError("Couldn't load checkpoint settings.");
      });
    return () => {
      configRequest.current += 1;
    };
  }, []);

  const loadInspection = useCallback((targetProjectId: string | null) => {
    const request = ++inspectRequest.current;
    setInspection(null);
    setInspectionError(null);
    if (!targetProjectId) {
      setInspectionLoading(false);
      return;
    }
    setInspectionLoading(true);
    void checkpointInspect(targetProjectId)
      .then((next) => {
        if (request !== inspectRequest.current) return;
        setInspection(next);
      })
      .catch(() => {
        if (request !== inspectRequest.current) return;
        setInspectionError("Couldn't read this project's checkpoint store.");
      })
      .finally(() => {
        if (request === inspectRequest.current) setInspectionLoading(false);
      });
  }, []);

  useEffect(() => {
    setCatalogOpen(false);
    setCheckpoints(null);
    setCheckpointsError(null);
    setExpanded([]);
    setFileStates({});
    loadInspection(projectId);
    return () => {
      inspectRequest.current += 1;
      listRequest.current += 1;
    };
  }, [projectId, loadInspection]);

  const writeConfig = (next: AppConfig) => {
    setConfigState(next);
    setConfigError(null);
    void setConfig(next).catch(() => setConfigError("Couldn't save checkpoint settings."));
  };

  const openCatalog = () => {
    const next = !catalogOpen;
    setCatalogOpen(next);
    if (!next || !projectId || checkpoints) return;
    const request = ++listRequest.current;
    setCheckpointsError(null);
    void checkpointList(projectId)
      .then((entries) => {
        if (request !== listRequest.current) return;
        setCheckpoints(entries);
      })
      .catch(() => {
        if (request !== listRequest.current) return;
        setCheckpointsError("Couldn't load this project's checkpoints.");
      });
  };

  const toggleCheckpoint = (snapshotRoot: string) => {
    const willExpand = !expanded.includes(snapshotRoot);
    setExpanded((current) =>
      willExpand ? [...current, snapshotRoot] : current.filter((entry) => entry !== snapshotRoot),
    );
    if (!willExpand || !projectId || fileStates[snapshotRoot]?.status === "ready") return;
    setFileStates((current) => ({ ...current, [snapshotRoot]: { status: "loading" } }));
    void checkpointFiles(projectId, snapshotRoot)
      .then((files) =>
        setFileStates((current) => ({ ...current, [snapshotRoot]: { status: "ready", files } })),
      )
      .catch(() =>
        setFileStates((current) => ({ ...current, [snapshotRoot]: { status: "error" } })),
      );
  };

  const checkpointsEnabled = config ? config.checkpoints_enabled !== false : true;
  const notificationsEnabled = config ? config.checkpoint_notifications !== false : true;
  const storePath = inspection?.store_path ?? null;
  const packBytes = inspection?.packs.reduce((total, pack) => total + pack.bytes, 0) ?? 0;
  const labels = checkpoints ? versionLabels(checkpoints) : new Map<string, string>();

  return (
    <div className="space-y-3 text-sm">
      <SectionCard
        title="Automatic checkpoints"
        description="A checkpoint records the source files a successful compile used."
      >
        <div className="space-y-2">
          <SettingsToggleRow
            label="Save a checkpoint after each successful compile"
            description="Oleafly saves it in the background and only when the source changed."
            checked={checkpointsEnabled}
            onChange={(value) => {
              if (!config) return;
              writeConfig({ ...config, checkpoints_enabled: value });
            }}
          />
          <SettingsToggleRow
            label="Show a notice when a checkpoint is skipped"
            description="Oleafly explains why a compile produced no checkpoint."
            checked={notificationsEnabled}
            onChange={(value) => {
              if (!config) return;
              writeConfig({ ...config, checkpoint_notifications: value });
            }}
          />
        </div>
        {configError ? (
          <p className="text-xs text-destructive" role="alert">
            {configError}
          </p>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Storage"
        description="Checkpoints live outside the project folder and outside version control."
      >
        {!projectId ? (
          <p className="text-xs text-muted-foreground">
            Open a project to see where its checkpoints are stored.
          </p>
        ) : inspectionLoading ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
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
              onClick={() => loadInspection(projectId)}
            >
              Try again
            </Button>
          </div>
        ) : !storePath ? (
          <p className="text-xs text-muted-foreground">
            This project has no checkpoint store yet. One is created with its first checkpoint.
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
                  {formatBytes(inspection?.catalog_bytes ?? 0)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] text-muted-foreground">Packs</dt>
                <dd className="truncate text-sm font-medium tabular-nums">
                  {(inspection?.table_counts.packs ?? 0).toLocaleString()}
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
            disabled={!projectId || !inspection}
            onClick={openCatalog}
            className="inline-flex items-center gap-1 rounded-md text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <ChevronRight
              aria-hidden
              className={`size-3 transition-transform ${catalogOpen ? "rotate-90" : ""}`}
            />
            Inspect catalog
          </button>

          {catalogOpen && inspection ? (
            <div id="checkpoint-catalog" className="mt-3 space-y-4">
              <CatalogFacts inspection={inspection} />
              <PackTable inspection={inspection} />
              <div>
                <h4 className="text-xs font-medium">Checkpoints</h4>
                {checkpointsError ? (
                  <p className="mt-1 text-[11px] text-destructive" role="alert">
                    {checkpointsError}
                  </p>
                ) : !checkpoints ? (
                  <p
                    className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground"
                    role="status"
                  >
                    <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
                    Loading checkpoints.
                  </p>
                ) : checkpoints.length === 0 ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">No checkpoints yet.</p>
                ) : (
                  <ul className="mt-1 list-none space-y-1 p-0">
                    {checkpoints.map((checkpoint) => {
                      const label = labels.get(checkpoint.snapshot_root) ?? "Checkpoint";
                      const isOpen = expanded.includes(checkpoint.snapshot_root);
                      return (
                        <li key={checkpoint.snapshot_root} className="border-t pt-1">
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? "Hide" : "Show"} files for ${label}`}
                            onClick={() => toggleCheckpoint(checkpoint.snapshot_root)}
                            className="flex w-full items-center gap-1.5 rounded-md py-0.5 text-left text-[11px] hover:text-foreground"
                          >
                            <ChevronRight
                              aria-hidden
                              className={`size-3 shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`}
                            />
                            <span className="font-medium tabular-nums">{label}</span>
                            <span className="truncate text-muted-foreground">
                              {formatCompletedAt(checkpoint.completed_at_unix_ms)}
                            </span>
                          </button>
                          {isOpen ? (
                            <div className="pl-4">
                              <CheckpointFileRows state={fileStates[checkpoint.snapshot_root]} />
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
      </SectionCard>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setSettingsOpen(false);
          setCheckpointsOpen(true);
        }}
      >
        Open Checkpoints
      </Button>
    </div>
  );
}
