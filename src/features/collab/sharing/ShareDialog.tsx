import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CopyPlus, Eye, Share2, X } from "lucide-react";
import { useShareDialog } from "@/components/collab/share-dialog";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/empty";
import { ModalShell } from "@/components/ui/modal-shell";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { formatBytes } from "@/lib/format-bytes";
import { formatNumber } from "@/lib/intl";
import { isFolderProject } from "@/lib/library-projects";
import {
  collabShareCheck,
  collabShareInfo,
  collabShareProject,
  onCollabShareProgress,
  type CollabServer,
  type CollabShareCheck,
  type CollabShareInfo,
} from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { collabErrorCode, collabErrorText } from "../errors";
import { InlineAlert, LoadFailed } from "../feedback";
import { useCollabStore } from "../store";
import { syncShareChange } from "./after-change";
import { copyThenShare } from "./copy-then-share";
import { ManageSharing } from "./ManageSharing";

type CheckState =
  | { kind: "checking" }
  | { kind: "ready"; check: CollabShareCheck }
  | { kind: "failed"; message: string; signedOut: boolean };

type UploadState =
  | { kind: "idle" }
  | { kind: "sharing"; done: number; total: number; reported: boolean }
  | { kind: "failed"; message: string; elsewhere: boolean };

function openCollaborationSettings() {
  useShareDialog.getState().close();
  const settings = useSettingsStore.getState();
  settings.setSettingsInitialSection("collaboration");
  settings.setSettingsOpen(true);
}

function PathList({ paths }: Readonly<{ paths: readonly string[] }>) {
  return (
    <ul className="max-h-28 select-text space-y-0.5 overflow-y-auto rounded-md bg-muted/40 px-3 py-2 font-mono text-xs">
      {paths.map((path) => (
        <li key={path} className="truncate">
          {path}
        </li>
      ))}
    </ul>
  );
}

function NoServers() {
  const { t } = useTranslation(["collab"]);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t(($) => $.collab.share.noServers)}</p>
      <Button type="button" variant="outline" onClick={openCollaborationSettings}>
        {t(($) => $.collab.share.openSettings)}
      </Button>
    </div>
  );
}

function CheckSummary({ check, server }: Readonly<{ check: CollabShareCheck; server: string }>) {
  const { t } = useTranslation(["collab"]);
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-2">
        <div className="rounded-md border bg-card px-3 py-2">
          <dt className="text-xs text-muted-foreground">{t(($) => $.collab.share.files)}</dt>
          <dd className="text-sm font-medium tabular-nums">{formatNumber(check.file_count)}</dd>
        </div>
        <div className="rounded-md border bg-card px-3 py-2">
          <dt className="text-xs text-muted-foreground">{t(($) => $.collab.share.size)}</dt>
          <dd className="text-sm font-medium tabular-nums">{formatBytes(check.total_bytes)}</dd>
        </div>
      </dl>
      {check.cloud_synced ? <InlineAlert>{t(($) => $.collab.share.cloudSynced)}</InlineAlert> : null}
      {check.too_large.length > 0 ? (
        <div className="space-y-1.5">
          <InlineAlert>
            {t(($) => $.collab.share.tooLarge, { size: formatNumber(check.max_file_mb) })}
          </InlineAlert>
          <PathList paths={check.too_large} />
        </div>
      ) : null}
      {check.renamed.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{t(($) => $.collab.share.renamed)}</p>
          <PathList paths={check.renamed} />
        </div>
      ) : null}
      {check.excluded.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">{t(($) => $.collab.share.excluded)}</p>
          <PathList paths={check.excluded} />
        </div>
      ) : null}
      <p className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
        <Eye aria-hidden className="mt-0.5 size-3.5 shrink-0 text-primary" />
        <span>{t(($) => $.collab.share.disclosure, { server })}</span>
      </p>
    </div>
  );
}

function ServerField({
  servers,
  value,
  disabled,
  onChange,
}: Readonly<{ servers: CollabServer[]; value: CollabServer; disabled: boolean; onChange: (id: string) => void }>) {
  const { t } = useTranslation(["collab"]);
  const label = t(($) => $.collab.share.serverLabel);
  if (servers.length === 1) {
    return (
      <p className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="truncate font-medium">{value.name}</span>
      </p>
    );
  }
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Select value={value.server_id} disabled={disabled} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="h-8 w-56 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="z-[130]">
          {servers.map((entry) => (
            <SelectItem key={entry.server_id} value={entry.server_id}>
              {entry.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ShareStep({
  projectId,
  servers,
  fromCopy,
  onShared,
}: Readonly<{
  projectId: string;
  servers: CollabServer[];
  fromCopy: boolean;
  onShared: (share: CollabShareInfo) => void;
}>) {
  const { t } = useTranslation(["collab", "common"]);
  const close = useShareDialog((state) => state.close);
  const [serverId, setServerId] = useState<string | null>(null);
  const server = servers.find((entry) => entry.server_id === serverId) ?? servers[0];
  const [check, setCheck] = useState<CheckState>({ kind: "checking" });
  const [checkRequest, setCheckRequest] = useState(0);
  const [upload, setUpload] = useState<UploadState>({ kind: "idle" });
  const chosenId = server.server_id;

  const load = useMemo(() => ({ projectId, chosenId, request: checkRequest }), [projectId, chosenId, checkRequest]);

  useEffect(() => {
    let active = true;
    setCheck({ kind: "checking" });
    setUpload({ kind: "idle" });
    collabShareCheck(load.projectId, load.chosenId).then(
      (result) => {
        if (active) setCheck({ kind: "ready", check: result });
      },
      (error: unknown) => {
        if (!active) return;
        const code = collabErrorCode(error);
        setCheck({
          kind: "failed",
          message: collabErrorText(error),
          signedOut: code === "unauthorized" || code === "signed_out",
        });
      },
    );
    return () => {
      active = false;
    };
  }, [load]);

  const ready = check.kind === "ready" ? check.check : null;
  const blocked = ready === null || ready.cloud_synced || ready.too_large.length > 0;
  const sharing = upload.kind === "sharing";

  const start = async () => {
    if (!ready || blocked || sharing) return;
    setUpload({ kind: "sharing", done: 0, total: 0, reported: false });
    useShareDialog.getState().setSharing(true);
    let unlisten: (() => void) | null = null;
    let shared: CollabShareInfo;
    try {
      unlisten = await onCollabShareProgress((progress) => {
        if (progress.projectId === projectId) {
          setUpload({ kind: "sharing", done: progress.done, total: progress.total, reported: true });
        }
      });
      shared = await collabShareProject(projectId, chosenId);
    } catch (error) {
      setUpload({
        kind: "failed",
        message: collabErrorText(error),
        elsewhere: collabErrorCode(error) === "share_in_progress",
      });
      return;
    } finally {
      unlisten?.();
      useShareDialog.getState().setSharing(false);
    }
    await syncShareChange(projectId);
    onShared(shared);
  };

  const renderCheck = () => {
    if (check.kind === "checking") {
      return <LoadingState size="compact" label={t(($) => $.collab.share.checking)} />;
    }
    if (check.kind === "failed") {
      return (
        <div className="space-y-3">
          <LoadFailed
            message={t(($) => $.collab.share.checkFailed)}
            reason={check.message}
            onRetry={() => setCheckRequest((count) => count + 1)}
          />
          {check.signedOut ? (
            <Button type="button" variant="outline" size="sm" onClick={openCollaborationSettings}>
              {t(($) => $.collab.share.openSettings)}
            </Button>
          ) : null}
        </div>
      );
    }
    return <CheckSummary check={check.check} server={server.name} />;
  };

  const renderUpload = () => {
    if (upload.kind === "sharing") {
      // The backend counts only figures and other non-text files. Before its
      // first report, and once they are all up and the project itself is
      // being saved, there is nothing to count, so the bar just shows activity.
      const counting = upload.reported && upload.total > 0 && upload.done < upload.total;
      let phase = t(($) => $.collab.share.preparing);
      if (counting) {
        phase = t(($) => $.collab.share.uploading, {
          done: formatNumber(upload.done),
          total: formatNumber(upload.total),
        });
      } else if (upload.reported) {
        phase = t(($) => $.collab.share.saving);
      }
      return (
        <div className="space-y-1.5">
          <Progress value={counting ? (upload.done / upload.total) * 100 : 0} indeterminate={!counting} />
          <p className="text-xs text-muted-foreground">{phase}</p>
        </div>
      );
    }
    if (upload.kind === "failed") {
      // Another share of this project is still running, so this one didn't fail as such.
      if (upload.elsewhere) return <InlineAlert>{upload.message}</InlineAlert>;
      return (
        <InlineAlert>
          {t(($) => $.collab.share.failed)} {upload.message}
        </InlineAlert>
      );
    }
    return null;
  };

  return (
    <div className="space-y-4">
      {fromCopy ? (
        <p className="rounded-md bg-primary/5 px-3 py-2 text-xs text-foreground">{t(($) => $.collab.share.editCopy)}</p>
      ) : null}
      <ServerField servers={servers} value={server} disabled={sharing} onChange={setServerId} />
      {renderCheck()}
      {renderUpload()}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" disabled={sharing} onClick={close}>
          {t(($) => $.common.actions.cancel)}
        </Button>
        <Button type="button" disabled={blocked || sharing} onClick={() => void start()}>
          {sharing ? <Spinner /> : <Share2 aria-hidden />}
          {upload.kind === "failed" ? t(($) => $.common.actions.retry) : t(($) => $.collab.share.start)}
        </Button>
      </div>
    </div>
  );
}

function CopyStep({ projectId, name }: Readonly<{ projectId: string; name: string }>) {
  const { t } = useTranslation(["collab", "common"]);
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t(($) => $.collab.share.linked)}</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => useShareDialog.getState().close()}>
          {t(($) => $.common.actions.cancel)}
        </Button>
        <Button type="button" onClick={() => void copyThenShare(projectId, name)}>
          <CopyPlus aria-hidden />
          {t(($) => $.collab.share.copyAndShare)}
        </Button>
      </div>
    </div>
  );
}

export function ShareDialog({ projectId }: Readonly<{ projectId: string }>) {
  const { t } = useTranslation(["collab", "common"]);
  const titleId = useId();
  const close = useShareDialog((state) => state.close);
  const sharing = useShareDialog((state) => state.sharing);
  const fromCopy = useShareDialog((state) => state.fromCopy);
  const project = useFilesStore((state) => state.projects.find((entry) => entry.id === projectId) ?? null);
  const servers = useCollabStore((state) => state.servers);
  const serversStatus = useCollabStore((state) => state.status);
  const loadServers = useCollabStore((state) => state.load);
  const [share, setShare] = useState<CollabShareInfo | null | undefined>(undefined);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareRequest, setShareRequest] = useState(0);
  const name = project?.name ?? "";

  useEffect(() => {
    if (serversStatus === "idle") void loadServers();
  }, [serversStatus, loadServers]);

  const load = useMemo(() => ({ projectId, request: shareRequest }), [projectId, shareRequest]);

  useEffect(() => {
    let active = true;
    setShareError(null);
    collabShareInfo(load.projectId).then(
      (info) => {
        if (active) setShare(info);
      },
      (error: unknown) => {
        if (active) setShareError(collabErrorText(error));
      },
    );
    return () => {
      active = false;
    };
  }, [load]);

  const signedIn = servers.filter((entry) => entry.signed_in);
  const serversKnown = serversStatus === "ready" || serversStatus === "failed" || signedIn.length > 0;

  const renderBody = () => {
    if (shareError) {
      return (
        <LoadFailed
          message={t(($) => $.collab.manage.loadFailed)}
          reason={shareError}
          onRetry={() => setShareRequest((count) => count + 1)}
        />
      );
    }
    if (share === undefined) return <LoadingState size="compact" label={t(($) => $.collab.share.loading)} />;
    if (share) return <ManageSharing projectId={projectId} name={name} share={share} />;
    if (!serversKnown) return <LoadingState size="compact" label={t(($) => $.collab.share.loading)} />;
    if (signedIn.length === 0) return <NoServers />;
    if (project && isFolderProject(project)) return <CopyStep projectId={projectId} name={name} />;
    return <ShareStep projectId={projectId} servers={signedIn} fromCopy={fromCopy} onShared={setShare} />;
  };

  return (
    <ModalShell
      open
      onClose={close}
      closeLabel={t(($) => $.common.actions.close)}
      width="lg"
      labelledBy={titleId}
      className="max-h-[calc(100vh-2rem)] space-y-4 overflow-y-auto p-5"
      testId="collab-share-dialog"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 id={titleId} className="truncate text-base font-semibold">
            {t(($) => $.collab.share.title, { name })}
          </h2>
          <p className="text-xs text-muted-foreground">{t(($) => $.collab.share.description)}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={t(($) => $.common.actions.close)}
          disabled={sharing}
          onClick={close}
        >
          <X aria-hidden className="size-4" />
        </Button>
      </div>
      {renderBody()}
    </ModalShell>
  );
}
