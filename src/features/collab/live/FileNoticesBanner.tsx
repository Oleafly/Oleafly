import { useMemo } from "react";
import { CloudAlert, CloudUpload, Files, FileWarning, FolderInput, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { WorkspaceBanner, WorkspaceBannerButton, type WorkspaceBannerTone } from "@/components/ui/workspace-banner";
import { formatBytes } from "@/lib/format-bytes";
import { formatList } from "@/lib/intl";
import { basename } from "@/lib/path-utils";
import type { CollabLiveKeptFile, CollabLocalCopyOffer, CollabUploadFile } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { collabErrorMessage } from "../errors";
import { useFileNotices } from "./file-notices";
import { useCollabLiveStore } from "./live-store";
import { PathMessage } from "./PathMessage";

const NO_UPLOADS: readonly CollabUploadFile[] = [];
const NO_KEPT: readonly CollabLiveKeptFile[] = [];

function Dismiss({ tone, onDismiss }: Readonly<{ tone: WorkspaceBannerTone; onDismiss: () => void }>) {
  const { t } = useTranslation(["collab"]);
  return (
    <WorkspaceBannerButton tone={tone} aria-label={t(($) => $.collab.files.dismiss)} onClick={onDismiss}>
      <X aria-hidden className="size-3.5" />
    </WorkspaceBannerButton>
  );
}

// How far a figure that is going up now got.
function UploadProgressLine({ path }: Readonly<{ path: string }>) {
  const { t } = useTranslation(["collab"]);
  const progress = useFileNotices((state) => state.progress[path]);
  if (!progress) return null;
  const text = t(($) => $.collab.files.uploading, {
    file: basename(path),
    done: formatBytes(progress.done),
    total: formatBytes(progress.total),
  });
  return (
    <div className="flex basis-full items-center gap-2 pl-5.5" data-testid="collab-upload-progress">
      <Progress value={(progress.done / progress.total) * 100} label={text} className="h-1 max-w-48" />
      <span className="min-w-0 truncate tabular-nums">{text}</span>
    </div>
  );
}

function UploadRow({ files, failed }: Readonly<{ files: readonly CollabUploadFile[]; failed: boolean }>) {
  const { t } = useTranslation(["collab"]);
  const retrying = useFileNotices((state) => state.retrying);
  const names = formatList(files.map((file) => basename(file.path)));
  const tone: WorkspaceBannerTone = failed ? "warning" : "primary";
  const message = failed
    ? t(($) => $.collab.files.failed, { files: names })
    : t(($) => $.collab.files.waiting, { files: names });
  return (
    <WorkspaceBanner tone={tone} data-testid={failed ? "collab-upload-failed" : "collab-upload-waiting"}>
      {failed ? (
        <CloudAlert aria-hidden className="size-3.5 shrink-0" />
      ) : (
        <CloudUpload aria-hidden className="size-3.5 shrink-0 text-primary" />
      )}
      <PathMessage paths={files.map((file) => file.path)}>{message}</PathMessage>
      <WorkspaceBannerButton
        tone={tone}
        className={failed ? undefined : "text-primary"}
        disabled={retrying}
        onClick={() => void useFileNotices.getState().retry()}
      >
        {retrying ? <Spinner size="xs" /> : null}
        {t(($) => $.collab.files.retry)}
      </WorkspaceBannerButton>
      {failed ? null : files.map((file) => <UploadProgressLine key={file.path} path={file.path} />)}
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

// A figure that would push the whole project past the server's limit. It
// goes up by itself once the limit is raised and the upload is tried again.
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
  const values = { name, file: basename(file.path), copy: basename(file.copy) };
  let message: string;
  if (file.kind === "replaced") message = t(($) => $.collab.files.replaced, values);
  else if (file.kind === "beside") message = t(($) => $.collab.files.beside, values);
  else message = t(($) => $.collab.files.added, values);
  return (
    <WorkspaceBanner tone="primary" data-testid="collab-kept-copy">
      <Files aria-hidden className="size-3.5 shrink-0 text-primary" />
      <PathMessage paths={[file.path, file.copy]}>{message}</PathMessage>
      <Dismiss tone="primary" onDismiss={() => useFileNotices.getState().dismissKept(file.id)} />
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
      {failure ? (
        <p role="alert" className="w-full select-text text-destructive">
          {collabErrorMessage(failure)}
        </p>
      ) : null}
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

export function FileNoticesBanner() {
  const { t } = useTranslation(["collab"]);
  const projectId = useFilesStore((state) => state.projectId);
  const notices = useFileNotices(
    useShallow((state) =>
      state.projectId === projectId && projectId !== null
        ? { uploads: state.uploads, kept: state.kept, offer: state.offer, broughtIn: state.broughtIn }
        : { uploads: NO_UPLOADS, kept: NO_KEPT, offer: null, broughtIn: null },
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
  const quiet =
    failed.length === 0 &&
    waiting.length === 0 &&
    tooLarge.length === 0 &&
    projectFull.length === 0 &&
    notices.kept.length === 0;
  if (quiet && !notices.offer && !notices.broughtIn) return null;
  const someone = t(($) => $.collab.toolbar.unknownPerson);
  return (
    <div className="flex shrink-0 flex-col">
      {notices.offer ? <LocalCopyRow offer={notices.offer} /> : null}
      {notices.broughtIn ? <BroughtInRow name={notices.broughtIn} /> : null}
      {failed.length > 0 ? <UploadRow files={failed} failed /> : null}
      {waiting.length > 0 ? <UploadRow files={waiting} failed={false} /> : null}
      {tooLarge.map((file) => (
        <TooLargeRow key={file.path} file={file} />
      ))}
      {projectFull.map((file) => (
        <ProjectTooLargeRow key={file.path} file={file} />
      ))}
      {notices.kept.map((file) => (
        <KeptRow key={file.id} file={file} name={(file.by ? names.get(file.by) : undefined) || someone} />
      ))}
    </div>
  );
}
