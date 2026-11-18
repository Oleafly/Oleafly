import type { OverleafStopReason } from "@oleafly/backend-port";
import { useMemo } from "react";
import { Cloud, CloudAlert, CloudDownload, CloudUpload, Files, FileWarning, FolderInput, History, Lock, Type, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import {
  WorkspaceBanner,
  WorkspaceBannerAlert,
  WorkspaceBannerButton,
  type WorkspaceBannerTone,
} from "@/components/ui/workspace-banner";
import { formatBytes } from "@/lib/format-bytes";
import { formatList, formatNumber } from "@/lib/intl";
import { basename } from "@/lib/path-utils";
import { cn } from "@/lib/utils";
import type { CollabLiveKeptFile, CollabLocalCopyOffer, CollabUploadFile } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { collabErrorMessage } from "../errors";
import { type DownloadProgress, useFileNotices } from "./file-notices";
import { useCollabLiveStore } from "./live-store";
import { type OverleafStopped, useOverleafNotices } from "./overleaf-notices";
import { PathMessage } from "./PathMessage";

const NO_UPLOADS: readonly CollabUploadFile[] = [];
const NO_KEPT: readonly CollabLiveKeptFile[] = [];
const NO_STOPPED: readonly OverleafStopped[] = [];
const NO_PATHS: readonly string[] = [];
const NO_DOWNLOADS: Readonly<Record<string, DownloadProgress>> = {};
const LIMITS: ReadonlySet<OverleafStopReason> = new Set(["too_long", "too_large", "too_many_ranges"]);
const MAX_COMMENTS = 500;
const MAX_TRACKED_CHANGES = 2000;

function Dismiss({ tone, onDismiss }: Readonly<{ tone: WorkspaceBannerTone; onDismiss: () => void }>) {
  const { t } = useTranslation(["collab"]);
  return (
    <WorkspaceBannerButton tone={tone} aria-label={t(($) => $.collab.files.dismiss)} onClick={onDismiss}>
      <X aria-hidden className="size-3.5" />
    </WorkspaceBannerButton>
  );
}

function TransferLine({
  text,
  progress,
  className,
  testId,
}: Readonly<{ text: string; progress: DownloadProgress; className?: string; testId: string }>) {
  const { done, total } = progress;
  return (
    <div className={cn("flex items-center gap-2", className)} data-testid={testId}>
      <Progress
        value={total ? (done / total) * 100 : 0}
        indeterminate={total === null}
        label={text}
        className="h-1 max-w-48"
      />
      <span className="min-w-0 truncate tabular-nums">{text}</span>
    </div>
  );
}

function UploadProgressLine({ path }: Readonly<{ path: string }>) {
  const { t } = useTranslation(["collab"]);
  const progress = useFileNotices((state) => state.progress[path]);
  if (!progress) return null;
  const text = t(($) => $.collab.files.uploading, {
    file: basename(path),
    done: formatBytes(progress.done),
    total: formatBytes(progress.total),
  });
  return <TransferLine text={text} progress={progress} className="basis-full pl-5.5" testId="collab-upload-progress" />;
}

function DownloadRow({ path, progress }: Readonly<{ path: string; progress: DownloadProgress }>) {
  const { t } = useTranslation(["collab"]);
  const file = basename(path);
  const done = formatBytes(progress.done);
  const text =
    progress.total === null
      ? t(($) => $.collab.files.downloadingSoFar, { file, done })
      : t(($) => $.collab.files.downloading, { file, done, total: formatBytes(progress.total) });
  return (
    <WorkspaceBanner tone="primary">
      <CloudDownload aria-hidden className="size-3.5 shrink-0 text-primary" />
      <TransferLine text={text} progress={progress} className="min-w-0 flex-1" testId="collab-download-progress" />
    </WorkspaceBanner>
  );
}

type UploadRowKind = "waiting" | "failed" | "account_storage_full" | "too_many_uploads";

const UPLOAD_ROW_TEST_IDS: Readonly<Record<UploadRowKind, string>> = {
  waiting: "collab-upload-waiting",
  failed: "collab-upload-failed",
  account_storage_full: "collab-upload-storage-full",
  too_many_uploads: "collab-upload-too-many",
};

function UploadRow({ files, kind }: Readonly<{ files: readonly CollabUploadFile[]; kind: UploadRowKind }>) {
  const { t } = useTranslation(["collab"]);
  const retrying = useFileNotices((state) => state.retrying);
  const names = formatList(files.map((file) => basename(file.path)));
  const waiting = kind === "waiting";
  const tone: WorkspaceBannerTone = waiting ? "primary" : "warning";
  let message: string;
  if (kind === "waiting") message = t(($) => $.collab.files.waiting, { files: names });
  else if (kind === "failed") message = t(($) => $.collab.files.failed, { files: names });
  else if (kind === "account_storage_full") message = t(($) => $.collab.files.accountStorageFull, { files: names });
  else message = t(($) => $.collab.files.tooManyUploads, { files: names });
  return (
    <WorkspaceBanner tone={tone} data-testid={UPLOAD_ROW_TEST_IDS[kind]}>
      {waiting ? (
        <CloudUpload aria-hidden className="size-3.5 shrink-0 text-primary" />
      ) : (
        <CloudAlert aria-hidden className="size-3.5 shrink-0" />
      )}
      <PathMessage paths={files.map((file) => file.path)}>{message}</PathMessage>
      <WorkspaceBannerButton
        tone={tone}
        className={waiting ? "text-primary" : undefined}
        disabled={retrying}
        onClick={() => void useFileNotices.getState().retry()}
      >
        {retrying ? <Spinner size="xs" /> : null}
        {t(($) => $.collab.files.retry)}
      </WorkspaceBannerButton>
      {waiting ? files.map((file) => <UploadProgressLine key={file.path} path={file.path} />) : null}
    </WorkspaceBanner>
  );
}

function TooLargeRow({ file }: Readonly<{ file: CollabUploadFile }>) {
  const { t } = useTranslation(["collab"]);
  const name = basename(file.path);
  const message =
    file.limit === null
      ? t(($) => $.collab.files.tooLargeUnknown, { file: name })
      : t(($) => $.collab.files.tooLarge, {
          file: name,
          size: formatBytes(file.size),
          limit: formatBytes(file.limit),
        });
  return (
    <WorkspaceBanner tone="warning" data-testid="collab-upload-too-large">
      <FileWarning aria-hidden className="size-3.5 shrink-0" />
      <PathMessage paths={[file.path]}>{message}</PathMessage>
      <Dismiss tone="warning" onDismiss={() => useFileNotices.getState().dismissUpload(file.path)} />
    </WorkspaceBanner>
  );
}

function ProjectTooLargeRow({ file }: Readonly<{ file: CollabUploadFile }>) {
  const { t } = useTranslation(["collab"]);
  const retrying = useFileNotices((state) => state.retrying);
  const name = basename(file.path);
  const message =
    file.limit === null
      ? t(($) => $.collab.files.projectTooLargeUnknown, { file: name })
      : t(($) => $.collab.files.projectTooLarge, { file: name, limit: formatBytes(file.limit) });
  return (
    <WorkspaceBanner tone="warning" data-testid="collab-upload-project-too-large">
      <FileWarning aria-hidden className="size-3.5 shrink-0" />
      <PathMessage paths={[file.path]}>{message}</PathMessage>
      <span className="flex shrink-0 items-center gap-1">
        <WorkspaceBannerButton
          tone="warning"
          disabled={retrying}
          onClick={() => void useFileNotices.getState().retry()}
        >
          {retrying ? <Spinner size="xs" /> : null}
          {t(($) => $.collab.files.retry)}
        </WorkspaceBannerButton>
        <Dismiss tone="warning" onDismiss={() => useFileNotices.getState().dismissUpload(file.path)} />
      </span>
    </WorkspaceBanner>
  );
}

function KeptRow({ file, name }: Readonly<{ file: CollabLiveKeptFile; name: string }>) {
  const { t } = useTranslation(["collab"]);
  const values = { name, file: basename(file.path), copy: file.copy ? basename(file.copy) : "" };
  let message: string;
  if (file.kind === "replaced") message = t(($) => $.collab.files.replaced, values);
  else if (file.kind === "beside") message = t(($) => $.collab.files.beside, values);
  else if (file.kind === "unsent" && file.copy) message = t(($) => $.collab.files.unsent, values);
  else if (file.kind === "unsent") message = t(($) => $.collab.files.unsentInFile, values);
  else if (file.kind === "differed") message = t(($) => $.collab.files.differed, values);
  else message = t(($) => $.collab.files.added, values);
  const unsent = file.kind === "unsent";
  const tone: WorkspaceBannerTone = unsent ? "warning" : "primary";
  return (
    <WorkspaceBanner tone={tone} data-testid="collab-kept-copy">
      {unsent ? (
        <CloudAlert aria-hidden className="size-3.5 shrink-0" />
      ) : (
        <Files aria-hidden className="size-3.5 shrink-0 text-primary" />
      )}
      <PathMessage paths={file.copy ? [file.path, file.copy] : [file.path]}>{message}</PathMessage>
      <Dismiss tone={tone} onDismiss={() => useFileNotices.getState().dismissKept(file.id)} />
    </WorkspaceBanner>
  );
}

function LocalCopyRow({ offer }: Readonly<{ offer: CollabLocalCopyOffer }>) {
  const { t } = useTranslation(["collab"]);
  const bringing = useFileNotices((state) => state.bringing);
  const failure = useFileNotices((state) => state.offerFailure);
  const files = formatList(offer.files.map(basename));
  return (
    <WorkspaceBanner tone="primary" data-testid="collab-local-copy-offer">
      <FolderInput aria-hidden className="size-3.5 shrink-0 text-primary" />
      <PathMessage paths={offer.files}>{t(($) => $.collab.files.localCopy, { files, name: offer.name })}</PathMessage>
      <span className="flex shrink-0 items-center gap-1">
        <WorkspaceBannerButton
          tone="primary"
          className="text-primary"
          disabled={bringing}
          onClick={() => void useFileNotices.getState().bringIn()}
        >
          {bringing ? <Spinner size="xs" /> : null}
          {t(($) => $.collab.files.bringIn)}
        </WorkspaceBannerButton>
        <WorkspaceBannerButton
          tone="primary"
          disabled={bringing}
          onClick={() => useFileNotices.getState().keepSeparate()}
        >
          {t(($) => $.collab.files.keepSeparate)}
        </WorkspaceBannerButton>
      </span>
      {failure ? <WorkspaceBannerAlert>{collabErrorMessage(failure)}</WorkspaceBannerAlert> : null}
    </WorkspaceBanner>
  );
}

function BroughtInRow({ name }: Readonly<{ name: string }>) {
  const { t } = useTranslation(["collab"]);
  return (
    <WorkspaceBanner tone="primary" data-testid="collab-local-copy-done">
      <Files aria-hidden className="size-3.5 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 select-text">{t(($) => $.collab.files.broughtIn, { name })}</p>
      <Dismiss tone="primary" onDismiss={() => useFileNotices.getState().dismissBroughtIn()} />
    </WorkspaceBanner>
  );
}

function StoppedActions({ path, retry = true }: Readonly<{ path: string; retry?: boolean }>) {
  const { t } = useTranslation(["collab"]);
  const busy = useOverleafNotices((state) => state.resolving !== null);
  const failed = useOverleafNotices((state) => state.failed === path);
  return (
    <>
      <span className="flex shrink-0 items-center gap-1">
        {retry ? (
          <WorkspaceBannerButton
            tone="warning"
            disabled={busy}
            onClick={() => void useOverleafNotices.getState().tryLiveAgain(path)}
          >
            {t(($) => $.collab.overleafBanners.tryLiveAgain)}
          </WorkspaceBannerButton>
        ) : null}
        <WorkspaceBannerButton
          tone="warning"
          disabled={busy}
          onClick={() => void useOverleafNotices.getState().keepCopy(path)}
        >
          {t(($) => $.collab.overleafBanners.keepMineAsCopy)}
        </WorkspaceBannerButton>
      </span>
      {failed ? (
        <WorkspaceBannerAlert>
          {t(($) => $.collab.overleafBanners.stoppedActionFailed, { file: basename(path) })}
        </WorkspaceBannerAlert>
      ) : null}
    </>
  );
}

function FaultRow({ stopped }: Readonly<{ stopped: OverleafStopped }>) {
  const { t } = useTranslation(["collab"]);
  const file = basename(stopped.path);
  const unsupported = stopped.reason === "unsupported";
  let message: string;
  if (unsupported) message = t(($) => $.collab.overleafBanners.faultUnsupported, { file });
  else if (stopped.reason === "unavailable") message = t(($) => $.collab.overleafBanners.faultUnavailable, { file });
  else message = t(($) => $.collab.overleafBanners.faultRefused, { file });
  return (
    <WorkspaceBanner tone="warning" data-testid="overleaf-fault-row">
      <CloudAlert aria-hidden className="size-3.5 shrink-0" />
      <PathMessage paths={[stopped.path]}>{message}</PathMessage>
      <StoppedActions path={stopped.path} retry={!unsupported} />
    </WorkspaceBanner>
  );
}

function LimitRow({ stopped }: Readonly<{ stopped: OverleafStopped }>) {
  const { t } = useTranslation(["collab"]);
  const file = basename(stopped.path);
  let message: string;
  if (stopped.reason === "too_long") message = t(($) => $.collab.overleafBanners.limitTooLong, { file });
  else if (stopped.reason === "too_large") message = t(($) => $.collab.overleafBanners.limitTooLarge, { file });
  else {
    message = t(($) => $.collab.overleafBanners.limitTooManyRanges, {
      file,
      comments: formatNumber(MAX_COMMENTS),
      changes: formatNumber(MAX_TRACKED_CHANGES),
    });
  }
  return (
    <WorkspaceBanner tone="warning" data-testid="overleaf-limit-row">
      <FileWarning aria-hidden className="size-3.5 shrink-0" />
      <PathMessage paths={[stopped.path]}>{message}</PathMessage>
      <StoppedActions path={stopped.path} />
    </WorkspaceBanner>
  );
}

function ExternalRow({ path }: Readonly<{ path: string }>) {
  const { t } = useTranslation(["collab"]);
  return (
    <WorkspaceBanner tone="primary" data-testid="overleaf-external-row">
      <History aria-hidden className="size-3.5 shrink-0 text-primary" />
      <PathMessage paths={[path]}>
        {t(($) => $.collab.overleafBanners.externalChange, { file: basename(path) })}
      </PathMessage>
      <Dismiss tone="primary" onDismiss={() => useOverleafNotices.getState().dismissExternal(path)} />
    </WorkspaceBanner>
  );
}

function ReplacedRow({ path }: Readonly<{ path: string }>) {
  const { t } = useTranslation(["collab"]);
  return (
    <WorkspaceBanner tone="warning" data-testid="overleaf-replaced-row">
      <Type aria-hidden className="size-3.5 shrink-0" />
      <PathMessage paths={[path]}>
        {t(($) => $.collab.overleafBanners.charactersReplaced, { file: basename(path) })}
      </PathMessage>
      <Dismiss tone="warning" onDismiss={() => useOverleafNotices.getState().dismissReplaced()} />
    </WorkspaceBanner>
  );
}

function NotAllowedRow({ paths }: Readonly<{ paths: readonly string[] }>) {
  const { t } = useTranslation(["collab"]);
  const files = formatList(paths.map(basename));
  return (
    <WorkspaceBanner tone="warning" data-testid="collab-tree-not-allowed">
      <Lock aria-hidden className="size-3.5 shrink-0" />
      <PathMessage paths={paths}>{t(($) => $.collab.overleafTree.notAllowed, { files })}</PathMessage>
      <Dismiss tone="warning" onDismiss={() => useFileNotices.getState().dismissNotAllowed()} />
    </WorkspaceBanner>
  );
}

function KeptAwayRow({ paths }: Readonly<{ paths: readonly string[] }>) {
  const { t } = useTranslation(["collab"]);
  const files = formatList(paths.map(basename));
  return (
    <WorkspaceBanner tone="primary" data-testid="collab-tree-kept-away">
      <Cloud aria-hidden className="size-3.5 shrink-0 text-primary" />
      <PathMessage paths={paths}>{t(($) => $.collab.overleafTree.keptAway, { files })}</PathMessage>
      <Dismiss tone="primary" onDismiss={() => useFileNotices.getState().dismissKeptAway()} />
    </WorkspaceBanner>
  );
}

export function FileNoticesBanner() {
  const { t } = useTranslation(["collab"]);
  const projectId = useFilesStore((state) => state.projectId);
  const notices = useFileNotices(
    useShallow((state) =>
      state.projectId === projectId && projectId !== null
        ? {
            uploads: state.uploads,
            kept: state.kept,
            offer: state.offer,
            broughtIn: state.broughtIn,
            notAllowed: state.notAllowed,
            keptAway: state.keptAway,
            downloads: state.downloads,
          }
        : {
            uploads: NO_UPLOADS,
            kept: NO_KEPT,
            offer: null,
            broughtIn: null,
            notAllowed: NO_PATHS,
            keptAway: NO_PATHS,
            downloads: NO_DOWNLOADS,
          },
    ),
  );
  const overleaf = useOverleafNotices(
    useShallow((state) =>
      state.projectId === projectId && projectId !== null
        ? { stopped: state.stopped, external: state.external, replaced: state.replaced }
        : { stopped: NO_STOPPED, external: NO_PATHS, replaced: null },
    ),
  );
  const members = useCollabLiveStore((state) => state.members);
  const names = useMemo(
    () => new Map(members.map((member) => [member.person.account_id, member.person.display_name])),
    [members],
  );
  const failed = notices.uploads.filter((file) => file.state === "failed");
  const waiting = notices.uploads.filter((file) => file.state === "waiting");
  const tooLarge = notices.uploads.filter((file) => file.state === "too_large");
  const projectFull = notices.uploads.filter((file) => file.state === "project_too_large");
  const storageFull = notices.uploads.filter((file) => file.state === "account_storage_full");
  const tooMany = notices.uploads.filter((file) => file.state === "too_many_uploads");
  const quiet =
    failed.length === 0 &&
    waiting.length === 0 &&
    tooLarge.length === 0 &&
    projectFull.length === 0 &&
    storageFull.length === 0 &&
    tooMany.length === 0 &&
    notices.kept.length === 0 &&
    notices.notAllowed.length === 0 &&
    notices.keptAway.length === 0 &&
    Object.keys(notices.downloads).length === 0 &&
    overleaf.stopped.length === 0 &&
    overleaf.external.length === 0;
  if (quiet && !notices.offer && !notices.broughtIn && !overleaf.replaced) return null;
  const someone = t(($) => $.collab.toolbar.unknownPerson);
  return (
    <div className="flex shrink-0 flex-col">
      {notices.offer ? <LocalCopyRow offer={notices.offer} /> : null}
      {notices.broughtIn ? <BroughtInRow name={notices.broughtIn} /> : null}
      {failed.length > 0 ? <UploadRow files={failed} kind="failed" /> : null}
      {storageFull.length > 0 ? <UploadRow files={storageFull} kind="account_storage_full" /> : null}
      {tooMany.length > 0 ? <UploadRow files={tooMany} kind="too_many_uploads" /> : null}
      {notices.notAllowed.length > 0 ? <NotAllowedRow paths={notices.notAllowed} /> : null}
      {waiting.length > 0 ? <UploadRow files={waiting} kind="waiting" /> : null}
      {Object.entries(notices.downloads).map(([path, progress]) => (
        <DownloadRow key={path} path={path} progress={progress} />
      ))}
      {notices.keptAway.length > 0 ? <KeptAwayRow paths={notices.keptAway} /> : null}
      {tooLarge.map((file) => (
        <TooLargeRow key={file.path} file={file} />
      ))}
      {projectFull.map((file) => (
        <ProjectTooLargeRow key={file.path} file={file} />
      ))}
      {notices.kept.map((file) => (
        <KeptRow key={file.id} file={file} name={(file.by ? names.get(file.by) : undefined) || someone} />
      ))}
      {overleaf.stopped.map((stopped) =>
        LIMITS.has(stopped.reason) ? (
          <LimitRow key={stopped.path} stopped={stopped} />
        ) : (
          <FaultRow key={stopped.path} stopped={stopped} />
        ),
      )}
      {overleaf.external.map((path) => (
        <ExternalRow key={path} path={path} />
      ))}
      {overleaf.replaced ? <ReplacedRow path={overleaf.replaced} /> : null}
    </div>
  );
}
