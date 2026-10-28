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
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { describeError } from "@/lib/app-error";
import type { CloudProgress, CloudProject, CloudState } from "@/lib/cloud";
import { formatBytes } from "@/lib/format-bytes";
import { formatList, formatNumber, formatRelativeTimeFrom } from "@/lib/intl";
import { cn } from "@/lib/utils";
import { cloudErrorCode, remoteBusyKey, useCloudProviderName, useCloudStore } from "@/store/cloud";
import {
  ChevronRight,
  CloudOff,
  Copy,
  Download,
  FileWarning,
  MoreHorizontal,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

type CloudTranslate = ReturnType<typeof useTranslation<["cloud"]>>["t"];

type PendingConfirm = { kind: "remove" | "removeRemote" | "replace" | "deleteHeld"; project: CloudProject };

type RemoteListState = "idle" | "loading" | "failed" | "ready";

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
  if (project.error || project.conflictCopies.length > 0) return 1;
  return 2;
}

function needsAttention(project: CloudProject): boolean {
  return attentionRank(project) < 2;
}

function isUnreadable(project: CloudProject): boolean {
  return cloudErrorCode(project.error) === "cloud.remote_unreadable";
}

function relative(t: CloudTranslate, timestamp: number, now: number): string {
  return formatRelativeTimeFrom(timestamp, now, {
    justNow: t(($) => $.cloud.projects.justNow),
  });
}

function remoteStatus(t: CloudTranslate, project: CloudProject, provider: string): string {
  if (project.recycled) return t(($) => $.cloud.row.recycled);
  if (project.pendingFiles === null) return t(($) => $.cloud.row.onlyInCloud, { provider });
  return project.uploadingFrom
    ? t(($) => $.cloud.row.stillUploading, { device: project.uploadingFrom })
    : t(($) => $.cloud.row.stillUploadingUnknown);
}

function rowStatus(
  t: CloudTranslate,
  project: CloudProject,
  provider: string,
  now: number,
  resumedAt?: number,
): string {
  if (project.mode === "download") return remoteStatus(t, project, provider);
  if (project.mode === "held") return t(($) => $.cloud.row.held);
  if (project.mode === "pause") return t(($) => $.cloud.row.paused);
  if (project.mode === "removed") {
    return project.removedBy
      ? t(($) => $.cloud.row.removed, { device: project.removedBy, provider })
      : t(($) => $.cloud.row.removedUnknown, { provider });
  }
  if (resumedAt !== undefined && project.lastSyncedMs < resumedAt) return t(($) => $.cloud.row.waitingToSync);
  return project.lastSyncedMs > 0
    ? t(($) => $.cloud.row.synced, { time: relative(t, project.lastSyncedMs, now) })
    : t(($) => $.cloud.row.waiting, { provider });
}

function transferText(t: CloudTranslate, progress: CloudProgress): string {
  if (progress.phase === "fetching") {
    return t(($) => $.cloud.transfer.fetching, {
      done: formatBytes(progress.done),
      total: formatBytes(progress.total),
    });
  }
  const values = { count: progress.total, done: formatNumber(progress.done), total: formatNumber(progress.total) };
  return progress.phase === "uploading"
    ? t(($) => $.cloud.transfer.uploading, values)
    : t(($) => $.cloud.transfer.downloading, values);
}

function TransferLine({ progress }: Readonly<{ progress: CloudProgress }>) {
  const { t } = useTranslation(["cloud"]);
  const text = transferText(t, progress);
  const share = progress.total > 0 ? (progress.done / progress.total) * 100 : 0;
  return (
    <div data-testid="cloud-transfer" className="mt-1 space-y-1">
      <p aria-live="polite" className="text-xs tabular-nums text-foreground">
        {text}
      </p>
      <Progress value={share} label={text} className="h-1 max-w-56" indicatorClassName="bg-primary" />
    </div>
  );
}

function summaryLine(
  t: CloudTranslate,
  provider: string,
  local: readonly CloudProject[],
  cloudOnly: number,
  remote: RemoteListState,
): string {
  const synced = local.filter((project) => project.mode === "sync" || project.mode === "held").length;
  const paused = local.length - synced;
  const parts = [
    synced > 0 ? t(($) => $.cloud.projects.synced, { count: synced }) : null,
    paused > 0 ? t(($) => $.cloud.projects.paused, { count: paused }) : null,
    cloudOnly > 0 ? t(($) => $.cloud.projects.onlyInCloud, { count: cloudOnly, provider }) : null,
  ].filter((part): part is string => part !== null);
  if (parts.length > 0) return formatList(parts, { type: "unit", style: "short" });
  if (remote === "loading") return t(($) => $.cloud.projects.checking, { provider });
  if (remote === "failed") return t(($) => $.cloud.projects.checkFailed, { provider });
  return t(($) => $.cloud.projects.none);
}

function statusLine(
  t: CloudTranslate,
  provider: string,
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
          ? t(($) => $.cloud.projects.offline, { provider })
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

function confirmCopy(
  t: CloudTranslate,
  provider: string,
  pending: PendingConfirm,
): { title: string; description: string; confirmLabel: string } {
  const name = pending.project.name;
  switch (pending.kind) {
    case "remove":
      return {
        title: t(($) => $.cloud.confirm.removeTitle, { name, provider }),
        description: t(($) => $.cloud.confirm.removeDescription, { provider }),
        confirmLabel: t(($) => $.cloud.confirm.removeAction, { provider }),
      };
    case "removeRemote":
      return {
        title: t(($) => $.cloud.confirm.removeTitle, { name, provider }),
        description: t(($) => $.cloud.confirm.removeRemoteDescription, { provider }),
        confirmLabel: t(($) => $.cloud.confirm.removeAction, { provider }),
      };
    case "replace":
      return {
        title: t(($) => $.cloud.confirm.replaceTitle, { name, provider }),
        description: t(($) => $.cloud.confirm.replaceDescription, { provider }),
        confirmLabel: t(($) => $.cloud.confirm.replaceAction),
      };
    case "deleteHeld": {
      const count = pending.project.hold?.count ?? 0;
      if (pending.project.hold?.kind === "remoteDelete") {
        return {
          title: t(($) => $.cloud.confirm.deleteHereTitle),
          description: t(($) => $.cloud.confirm.deleteHereDescription, { count, name, provider }),
          confirmLabel: t(($) => $.cloud.confirm.deleteHereAction),
        };
      }
      return {
        title: t(($) => $.cloud.confirm.deleteTitle, { provider }),
        description: t(($) => $.cloud.confirm.deleteDescription, { count, name, provider }),
        confirmLabel: t(($) => $.cloud.confirm.deleteAction, { provider }),
      };
    }
  }
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
  const removing = useCloudStore((s) => s.busyProjects.includes(remoteBusyKey(project.cloudId)));
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
        disabled={anyDownload || removing}
        onClick={() => void downloadProject(project.cloudId)}
      >
        {downloadingThis ? <Spinner size="sm" /> : <Download aria-hidden className="size-4" />}
      </Button>
    </Tooltip>
  );
}

function RowMenu({
  project,
  busyKey,
  onRemove,
}: Readonly<{ project: CloudProject; busyKey: string; onRemove: () => void }>) {
  const { t } = useTranslation(["cloud"]);
  const provider = useCloudProviderName();
  const busy = useCloudStore((s) => s.busyProjects.includes(busyKey) || s.downloading.includes(project.cloudId));
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
          {busy && project.localId === null ? <Spinner size="sm" /> : <MoreHorizontal aria-hidden className="size-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="z-[100]">
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          data-testid="cloud-project-remove"
          onSelect={onRemove}
        >
          <CloudOff aria-hidden className="size-4" />
          {t(($) => $.cloud.row.remove, { provider })}
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
  const provider = useCloudProviderName();
  const hold = project.hold;
  if (!hold) return null;
  const remote = hold.kind === "remoteDelete";
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
            {remote ? t(($) => $.cloud.row.putBackInCloud, { provider }) : t(($) => $.cloud.row.putBack)}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={onDelete}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive"
          >
            {remote ? t(($) => $.cloud.row.deleteHere) : t(($) => $.cloud.row.deleteToo, { provider })}
          </Button>
        </>
      }
    >
      {remote
        ? t(($) => $.cloud.row.heldRemoteMessage, { count: hold.count, total: hold.total, provider })
        : t(($) => $.cloud.row.heldMessage, { count: hold.count, total: hold.total, provider })}
    </CloudNotice>
  );
}

function UnreadableNotice({ project, onReplace }: Readonly<{ project: CloudProject; onReplace: () => void }>) {
  const { t } = useTranslation(["cloud"]);
  const busy = useCloudStore((s) => s.busyProjects.includes(project.localId as string));
  return (
    <CloudNotice
      tone="danger"
      icon={FileWarning}
      testId="cloud-project-unreadable"
      className="mt-2"
      actions={
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onReplace}>
          {busy ? <Spinner /> : null}
          {t(($) => $.cloud.row.replace)}
        </Button>
      }
    >
      {describeError(project.error)}
    </CloudNotice>
  );
}

function ConflictNotice({ project }: Readonly<{ project: CloudProject }>) {
  const { t } = useTranslation(["cloud"]);
  const localId = project.localId as string;
  const busy = useCloudStore((s) => s.busyProjects.includes(localId));
  const dismissConflicts = useCloudStore((s) => s.dismissConflicts);
  const count = project.conflictCopies.length || project.conflicts;
  return (
    <CloudNotice
      tone="warning"
      icon={Copy}
      testId="cloud-project-conflicts"
      className="mt-2"
      actions={
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void dismissConflicts(localId)}>
          {t(($) => $.cloud.row.dismiss)}
        </Button>
      }
      details={
        project.conflictCopies.length > 0 ? (
          <ul
            aria-label={t(($) => $.cloud.row.conflictsLabel, { name: project.name })}
            className="mt-2 space-y-0.5 pl-6.5"
          >
            {project.conflictCopies.map((path) => (
              <li key={path} className="select-text break-all">
                {path}
              </li>
            ))}
          </ul>
        ) : null
      }
    >
      <span className="block font-medium">{t(($) => $.cloud.row.conflicts, { count })}</span>
      <span className="block">{t(($) => $.cloud.row.conflictsHelp, { count })}</span>
    </CloudNotice>
  );
}

function SkippedFiles({ project }: Readonly<{ project: CloudProject }>) {
  const { t } = useTranslation(["cloud"]);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const label = t(($) => $.cloud.row.skipped, { count: project.skipped });
  if (project.skippedFiles.length === 0) return <p className="text-xs text-muted-foreground">{label}</p>;
  const more = project.skipped - project.skippedFiles.length;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        data-testid="cloud-project-skipped"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1 rounded text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
      >
        {label}
        <ChevronRight
          aria-hidden
          className={cn("size-3 shrink-0 motion-safe:transition-transform", open && "rotate-90")}
        />
      </button>
      {open ? (
        <ul
          id={listId}
          aria-label={t(($) => $.cloud.row.skippedLabel, { name: project.name })}
          className="mt-1 space-y-0.5 text-xs"
        >
          {project.skippedFiles.map((file) => (
            <li key={file.path} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span className="min-w-0 select-text break-all text-foreground">{file.path}</span>
              <span className="text-muted-foreground">{t(($) => $.cloud.row.skipReason[file.reason])}</span>
            </li>
          ))}
          {more > 0 ? (
            <li className="text-muted-foreground">{t(($) => $.cloud.row.skippedMore, { count: more })}</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function RowSize({ project }: Readonly<{ project: CloudProject }>) {
  const { t } = useTranslation(["cloud"]);
  if (project.sizeBytes <= 0) return null;
  const size = formatBytes(project.sizeBytes);
  return (
    <span className="mr-1 text-xs tabular-nums text-muted-foreground">
      {project.mode === "download" && project.pendingFiles !== null ? t(($) => $.cloud.row.sizeSoFar, { size }) : size}
    </span>
  );
}

function RowNotices({
  project,
  onConfirm,
}: Readonly<{ project: CloudProject; onConfirm: (pending: PendingConfirm) => void }>) {
  const conflicted = project.conflictCopies.length > 0 || project.conflicts > 0;
  return (
    <>
      {project.mode === "held" ? (
        <HeldNotice project={project} onDelete={() => onConfirm({ kind: "deleteHeld", project })} />
      ) : null}
      {isUnreadable(project) ? (
        <UnreadableNotice project={project} onReplace={() => onConfirm({ kind: "replace", project })} />
      ) : null}
      {conflicted ? <ConflictNotice project={project} /> : null}
    </>
  );
}

function isRemovable(project: CloudProject, local: boolean, connected: boolean): boolean {
  if (!local) return connected;
  return (project.mode === "sync" || project.mode === "pause") && project.lastSyncedMs > 0;
}

function ProjectRow({
  project,
  now,
  onConfirm,
}: Readonly<{ project: CloudProject; now: number; onConfirm: (pending: PendingConfirm) => void }>) {
  const { t } = useTranslation(["cloud"]);
  const provider = useCloudProviderName();
  const connected = useCloudStore((s) => s.status === "connected");
  const local = project.localId !== null && project.mode !== "download";
  const removable = isRemovable(project, local, connected);
  const unreadable = local && isUnreadable(project);
  const progressKey = local ? (project.localId as string) : project.cloudId;
  const progress = useCloudStore((s) => s.progress[progressKey]);
  const resumedAt = useCloudStore((s) => (local ? s.resumedAt[project.localId as string] : undefined));
  const transferring = progress !== undefined && progress.done < progress.total;
  return (
    <li data-testid="cloud-project-row" className="px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            <Tooltip label={project.name} className="inline">
              {project.name}
            </Tooltip>
          </p>
          {transferring ? (
            <TransferLine progress={progress} />
          ) : (
            <p className="text-xs text-muted-foreground">{rowStatus(t, project, provider, now, resumedAt)}</p>
          )}
          {project.error && !unreadable ? (
            <p className="break-words text-xs text-destructive">{describeError(project.error)}</p>
          ) : null}
          {project.skipped > 0 ? <SkippedFiles project={project} /> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <RowSize project={project} />
          {local ? <ProjectSwitch project={project} /> : <DownloadButton project={project} />}
          {removable ? (
            <RowMenu
              project={project}
              busyKey={local ? (project.localId as string) : remoteBusyKey(project.cloudId)}
              onRemove={() => onConfirm({ kind: local ? "remove" : "removeRemote", project })}
            />
          ) : (
            <span aria-hidden className="size-8 shrink-0" />
          )}
        </div>
      </div>
      {local ? <RowNotices project={project} onConfirm={onConfirm} /> : null}
    </li>
  );
}

function RemoteListStatus({ state }: Readonly<{ state: RemoteListState }>) {
  const { t } = useTranslation(["cloud"]);
  const retryDetails = useCloudStore((s) => s.retryDetails);
  const provider = useCloudProviderName();
  if (state === "loading") {
    return (
      <li data-testid="cloud-remote-loading" className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground">
        <Spinner size="sm" />
        {t(($) => $.cloud.projects.checking, { provider })}
      </li>
    );
  }
  if (state !== "failed") return null;
  return (
    <li data-testid="cloud-remote-error" className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 text-xs">
      <span className="min-w-0 flex-1 basis-48 text-destructive">
        {t(($) => $.cloud.projects.checkFailed, { provider })}
      </span>
      <Button type="button" size="sm" variant="outline" onClick={() => void retryDetails()}>
        {t(($) => $.cloud.tryAgain)}
      </Button>
    </li>
  );
}

function ProjectsActions({ downloadable, state }: Readonly<{ downloadable: number; state: CloudState }>) {
  const { t } = useTranslation(["cloud"]);
  const syncing = useCloudStore((s) => s.syncing);
  const progress = useCloudStore((s) => s.downloadProgress);
  const anyDownload = useCloudStore((s) => s.downloading.length > 0);
  const syncNow = useCloudStore((s) => s.syncNow);
  const downloadAll = useCloudStore((s) => s.downloadAll);
  return (
    <>
      {downloadable > 0 || progress ? (
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
  const remoteList = useCloudStore((s): RemoteListState => {
    if (s.status !== "connected") return "idle";
    if (!s.detailsLoaded) return "loading";
    return s.detailsError ? "failed" : "ready";
  });
  const resolveHold = useCloudStore((s) => s.resolveHold);
  const removeProject = useCloudStore((s) => s.removeProject);
  const removeRemote = useCloudStore((s) => s.removeRemote);
  const replaceRemote = useCloudStore((s) => s.replaceRemote);
  const provider = useCloudProviderName();
  const now = useNow();
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [defaultOpen] = useState(() => state?.projects.some(needsAttention) ?? false);

  if (!state) return null;

  const local = [...state.projects].sort((a, b) => attentionRank(a) - attentionRank(b));
  const known = new Set(local.map((project) => project.cloudId).filter(Boolean));
  const cloudOnly = remote.filter((project) => project.mode === "download" && !known.has(project.cloudId));
  const downloadable = cloudOnly.filter((project) => !project.recycled).length;
  const status = statusLine(t, provider, state, syncing, syncError, now);
  const settled = remoteList === "ready" || remoteList === "idle";
  const empty = local.length === 0 && cloudOnly.length === 0 && settled;
  const copy = confirm ? confirmCopy(t, provider, confirm) : null;

  const confirmAction = () => {
    if (!confirm) return;
    const { kind, project } = confirm;
    setConfirm(null);
    if (kind === "removeRemote") {
      void removeRemote(project.cloudId);
      return;
    }
    if (!project.localId) return;
    if (kind === "remove") void removeProject(project.localId);
    else if (kind === "replace") void replaceRemote(project.localId);
    else void resolveHold(project.localId, "delete");
  };

  return (
    <>
      <CollapsibleSection
        id="cloud-projects"
        defaultOpen={defaultOpen}
        title={t(($) => $.cloud.projects.title)}
        description={
          <>
            <span className="block truncate">{summaryLine(t, provider, local, cloudOnly.length, remoteList)}</span>
            <span
              data-testid="cloud-sync-status"
              className={cn("flex items-center gap-1.5", status.problem && "text-amber-700 dark:text-amber-300")}
            >
              {syncing ? <Spinner size="sm" /> : null}
              {status.text}
            </span>
          </>
        }
        trailing={<ProjectsActions downloadable={downloadable} state={state} />}
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
            <RemoteListStatus state={remoteList} />
          </ul>
        )}
        {state.linkedCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            {t(($) => $.cloud.projects.linkedNote, { count: state.linkedCount })}
          </p>
        ) : null}
      </CollapsibleSection>
      <ConfirmationDialog
        open={copy !== null}
        destructive
        title={copy?.title ?? ""}
        description={copy?.description ?? ""}
        confirmLabel={copy?.confirmLabel ?? ""}
        onConfirm={confirmAction}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
