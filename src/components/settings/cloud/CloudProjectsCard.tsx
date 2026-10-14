import { CloudNotice } from "@/components/settings/cloud/CloudNotice";
import { SettingsSwitchIndicator } from "@/components/settings/SettingsToggleRow";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { describeError } from "@/lib/app-error";
import type { CloudProject, CloudState } from "@/lib/cloud";
import { formatBytes } from "@/lib/format-bytes";
import { formatList, formatRelativeTimeFrom } from "@/lib/intl";
import { cn } from "@/lib/utils";
import { cloudErrorCode, useCloudStore } from "@/store/cloud";
import { CloudOff, Download, MoreHorizontal, RefreshCw, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type CloudTranslate = ReturnType<typeof useTranslation<["cloud"]>>["t"];

type PendingConfirm = { kind: "remove" | "deleteHeld"; project: CloudProject };

const NOW_TICK_MS = 30_000;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function attentionRank(project: CloudProject): number {
  if (project.mode === "held") return 0;
  if (project.error) return 1;
  return 2;
}

function needsAttention(project: CloudProject): boolean {
  return attentionRank(project) < 2;
}

function relative(t: CloudTranslate, timestamp: number, now: number): string {
  return formatRelativeTimeFrom(timestamp, now, {
    justNow: t(($) => $.cloud.projects.justNow),
  });
}

function rowStatus(t: CloudTranslate, project: CloudProject, now: number): string {
  if (project.mode === "download") {
    return project.recycled
      ? t(($) => $.cloud.row.recycled)
      : t(($) => $.cloud.row.onlyInDropbox);
  }
  if (project.mode === "held") return t(($) => $.cloud.row.held);
  if (project.mode === "pause") return t(($) => $.cloud.row.paused);
  if (project.mode === "removed") {
    return project.removedBy
      ? t(($) => $.cloud.row.removed, { device: project.removedBy })
      : t(($) => $.cloud.row.removedUnknown);
  }
  return project.lastSyncedMs > 0
    ? t(($) => $.cloud.row.synced, { time: relative(t, project.lastSyncedMs, now) })
    : t(($) => $.cloud.row.waiting);
}

function summaryLine(t: CloudTranslate, local: readonly CloudProject[], cloudOnly: number): string {
  const synced = local.filter((project) => project.mode === "sync" || project.mode === "held").length;
  const paused = local.length - synced;
  const parts = [
    synced > 0 ? t(($) => $.cloud.projects.synced, { count: synced }) : null,
    paused > 0 ? t(($) => $.cloud.projects.paused, { count: paused }) : null,
    cloudOnly > 0 ? t(($) => $.cloud.projects.onlyInDropbox, { count: cloudOnly }) : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return t(($) => $.cloud.projects.none);
  return formatList(parts, { type: "unit", style: "short" });
}

function statusLine(
  t: CloudTranslate,
  state: CloudState,
  syncing: boolean,
  syncError: string | null,
  now: number,
): { text: string; problem: boolean } {
  if (syncing) return { text: t(($) => $.cloud.projects.syncing), problem: false };
  if (!state.enabled) return { text: t(($) => $.cloud.projects.off), problem: false };
  const problem = syncError ?? state.lastError;
  const code = cloudErrorCode(problem);
  if (problem && state.status === "connected" && code !== "cloud.revoked" && code !== "cloud.quota_full") {
    return {
      text:
        code === "cloud.network"
          ? t(($) => $.cloud.projects.offline)
          : describeError(problem),
      problem: true,
    };
  }
  if (state.lastSyncedMs > 0) {
    return {
      text: t(($) => $.cloud.projects.lastSynced, { time: relative(t, state.lastSyncedMs, now) }),
      problem: false,
    };
  }
  return { text: t(($) => $.cloud.projects.notSynced), problem: false };
}

function ProjectSwitch({ project }: Readonly<{ project: CloudProject }>) {
  const { t } = useTranslation(["cloud"]);
  const localId = project.localId as string;
  const busy = useCloudStore((s) => s.busyProjects.includes(localId));
  const setProjectMode = useCloudStore((s) => s.setProjectMode);
  const on = project.mode === "sync" || project.mode === "held";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={t(($) => $.cloud.row.syncSwitch, { name: project.name })}
      disabled={busy}
      onClick={() => void setProjectMode(localId, on ? "pause" : "sync")}
      className="inline-flex shrink-0 rounded-full p-1 transition-colors hover:bg-accent focus-visible:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      <SettingsSwitchIndicator checked={on} />
    </button>
  );
}

function DownloadButton({ project }: Readonly<{ project: CloudProject }>) {
  const { t } = useTranslation(["cloud"]);
  const downloadingThis = useCloudStore((s) => s.downloading.includes(project.cloudId));
  const anyDownload = useCloudStore((s) => s.downloading.length > 0 || s.downloadProgress !== null);
  const downloadProject = useCloudStore((s) => s.downloadProject);
  const label = project.recycled
    ? t(($) => $.cloud.row.restore, { name: project.name })
    : t(($) => $.cloud.row.download, { name: project.name });
  return (
    <Tooltip label={label} side="left">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={label}
        data-testid="cloud-project-download"
        disabled={anyDownload}
        onClick={() => void downloadProject(project.cloudId)}
      >
        {downloadingThis ? <Spinner size="sm" /> : <Download aria-hidden className="size-4" />}
      </Button>
    </Tooltip>
  );
}

function RowMenu({ project, onRemove }: Readonly<{ project: CloudProject; onRemove: () => void }>) {
  const { t } = useTranslation(["cloud"]);
  const busy = useCloudStore((s) => s.busyProjects.includes(project.localId as string));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={busy}
          aria-label={t(($) => $.cloud.row.more, { name: project.name })}
          data-testid="cloud-project-menu"
        >
          <MoreHorizontal aria-hidden className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[100]">
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          data-testid="cloud-project-remove"
          onSelect={onRemove}
        >
          <CloudOff aria-hidden className="size-4" />
          {t(($) => $.cloud.row.remove)}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HeldNotice({ project, onDelete }: Readonly<{ project: CloudProject; onDelete: () => void }>) {
  const { t } = useTranslation(["cloud"]);
  const localId = project.localId as string;
  const busy = useCloudStore((s) => s.busyProjects.includes(localId));
  const resolveHold = useCloudStore((s) => s.resolveHold);
  const hold = project.hold;
  if (!hold) return null;
  return (
    <CloudNotice
      tone="warning"
      icon={ShieldAlert}
      testId="cloud-project-held"
      className="mt-2"
      actions={
        <>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void resolveHold(localId, "restore")}>
            {busy ? <Spinner /> : null}
            {t(($) => $.cloud.row.putBack)}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={onDelete}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive"
          >
            {t(($) => $.cloud.row.deleteToo)}
          </Button>
        </>
      }
    >
      {t(($) => $.cloud.row.heldMessage, { count: hold.count, total: hold.total })}
    </CloudNotice>
  );
}

function ProjectRow({
  project,
  now,
  onConfirm,
}: Readonly<{ project: CloudProject; now: number; onConfirm: (pending: PendingConfirm) => void }>) {
  const { t } = useTranslation(["cloud"]);
  const local = project.localId !== null && project.mode !== "download";
  const removable = local && (project.mode === "sync" || project.mode === "pause") && project.lastSyncedMs > 0;
  return (
    <li data-testid="cloud-project-row" className="px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground" title={project.name}>
            {project.name}
          </p>
          <p className="text-xs text-muted-foreground">{rowStatus(t, project, now)}</p>
          {project.error ? <p className="break-words text-xs text-destructive">{describeError(project.error)}</p> : null}
          {project.conflicts > 0 ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {t(($) => $.cloud.row.conflicts, { count: project.conflicts })}
            </p>
          ) : null}
          {project.skipped > 0 ? (
            <p className="text-xs text-muted-foreground">
              {t(($) => $.cloud.row.skipped, { count: project.skipped })}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {project.sizeBytes > 0 ? (
            <span className="mr-1 text-xs tabular-nums text-muted-foreground">{formatBytes(project.sizeBytes)}</span>
          ) : null}
          {local ? <ProjectSwitch project={project} /> : <DownloadButton project={project} />}
          {removable ? (
            <RowMenu project={project} onRemove={() => onConfirm({ kind: "remove", project })} />
          ) : (
            <span aria-hidden className="size-8 shrink-0" />
          )}
        </div>
      </div>
      {project.mode === "held" && local ? (
        <HeldNotice project={project} onDelete={() => onConfirm({ kind: "deleteHeld", project })} />
      ) : null}
    </li>
  );
}

function ProjectsActions({ cloudOnly, state }: Readonly<{ cloudOnly: number; state: CloudState }>) {
  const { t } = useTranslation(["cloud"]);
  const syncing = useCloudStore((s) => s.syncing);
  const progress = useCloudStore((s) => s.downloadProgress);
  const anyDownload = useCloudStore((s) => s.downloading.length > 0);
  const syncNow = useCloudStore((s) => s.syncNow);
  const downloadAll = useCloudStore((s) => s.downloadAll);
  return (
    <>
      {cloudOnly > 0 || progress ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="cloud-download-all"
          disabled={progress !== null || anyDownload}
          onClick={() => void downloadAll()}
        >
          {progress ? <Spinner /> : <Download aria-hidden className="size-3.5" />}
          {progress
            ? t(($) => $.cloud.projects.downloading, {
                current: Math.min(progress.done + 1, progress.total),
                total: progress.total,
              })
            : t(($) => $.cloud.projects.downloadAll)}
        </Button>
      ) : null}
      <Button
        type="button"
        size="sm"
        data-testid="cloud-sync-now"
        disabled={syncing || !state.enabled || state.status !== "connected"}
        onClick={() => void syncNow(true)}
      >
        {syncing ? <Spinner /> : <RefreshCw aria-hidden className="size-3.5" />}
        {t(($) => $.cloud.projects.syncNow)}
      </Button>
    </>
  );
}

export function CloudProjectsCard() {
  const { t } = useTranslation(["cloud"]);
  const state = useCloudStore((s) => s.state);
  const remote = useCloudStore((s) => s.remote);
  const syncing = useCloudStore((s) => s.syncing);
  const syncError = useCloudStore((s) => s.syncError);
  const resolveHold = useCloudStore((s) => s.resolveHold);
  const removeProject = useCloudStore((s) => s.removeProject);
  const now = useNow();
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [defaultOpen] = useState(() => state?.projects.some(needsAttention) ?? false);

  if (!state) return null;

  const local = [...state.projects].sort((a, b) => attentionRank(a) - attentionRank(b));
  const known = new Set(local.map((project) => project.cloudId).filter(Boolean));
  const cloudOnly = remote.filter((project) => project.mode === "download" && !known.has(project.cloudId));
  const status = statusLine(t, state, syncing, syncError, now);
  const empty = local.length === 0 && cloudOnly.length === 0;

  const confirmAction = () => {
    if (!confirm?.project.localId) return;
    const localId = confirm.project.localId;
    if (confirm.kind === "remove") void removeProject(localId);
    else void resolveHold(localId, "delete");
    setConfirm(null);
  };

  return (
    <>
      <CollapsibleSection
        id="cloud-projects"
        defaultOpen={defaultOpen}
        title={t(($) => $.cloud.projects.title)}
        description={
          <>
            <span className="block truncate">{summaryLine(t, local, cloudOnly.length)}</span>
            <span
              data-testid="cloud-sync-status"
              className={cn("flex items-center gap-1.5", status.problem && "text-amber-700 dark:text-amber-300")}
            >
              {syncing ? <Spinner size="sm" /> : null}
              {status.text}
            </span>
          </>
        }
        trailing={<ProjectsActions cloudOnly={cloudOnly.length} state={state} />}
      >
        {empty ? (
          <p className="text-xs text-muted-foreground">{t(($) => $.cloud.projects.empty)}</p>
        ) : (
          <ul
            aria-label={t(($) => $.cloud.projects.listLabel)}
            className="max-h-80 divide-y overflow-y-auto rounded-md border bg-background"
          >
            {local.map((project) => (
              <ProjectRow
                key={project.localId ?? project.cloudId}
                project={project}
                now={now}
                onConfirm={setConfirm}
              />
            ))}
            {cloudOnly.map((project) => (
              <ProjectRow key={`cloud:${project.cloudId}`} project={project} now={now} onConfirm={setConfirm} />
            ))}
          </ul>
        )}
        {state.linkedCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            {t(($) => $.cloud.projects.linkedNote, { count: state.linkedCount })}
          </p>
        ) : null}
      </CollapsibleSection>
      <ConfirmationDialog
        open={confirm !== null}
        destructive
        title={
          confirm?.kind === "remove"
            ? t(($) => $.cloud.confirm.removeTitle, { name: confirm.project.name })
            : t(($) => $.cloud.confirm.deleteTitle)
        }
        description={
          confirm?.kind === "remove"
            ? t(($) => $.cloud.confirm.removeDescription)
            : t(($) => $.cloud.confirm.deleteDescription, {
                count: confirm?.project.hold?.count ?? 0,
                name: confirm?.project.name ?? "",
              })
        }
        confirmLabel={
          confirm?.kind === "remove"
            ? t(($) => $.cloud.confirm.removeAction)
            : t(($) => $.cloud.confirm.deleteAction)
        }
        onConfirm={confirmAction}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
