import { useMemo } from "react";
import { CloudAlert, CloudUpload, Files, FileWarning, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { Spinner } from "@/components/ui/spinner";
import { WorkspaceBanner, WorkspaceBannerButton, type WorkspaceBannerTone } from "@/components/ui/workspace-banner";
import { formatBytes } from "@/lib/format-bytes";
import { formatList } from "@/lib/intl";
import type { CollabLiveKeptFile, CollabUploadFile } from "@/lib/tauri";
import { useFilesStore } from "@/store/files";
import { useFileNotices } from "./file-notices";
import { useCollabLiveStore } from "./live-store";

const NO_UPLOADS: readonly CollabUploadFile[] = [];
const NO_KEPT: readonly CollabLiveKeptFile[] = [];

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function Dismiss({ tone, onDismiss }: Readonly<{ tone: WorkspaceBannerTone; onDismiss: () => void }>) {
  const { t } = useTranslation(["collab"]);
  return (
    <WorkspaceBannerButton tone={tone} aria-label={t(($) => $.collab.files.dismiss)} onClick={onDismiss}>
      <X aria-hidden className="size-3.5" />
    </WorkspaceBannerButton>
  );
}

function UploadRow({ files, failed }: Readonly<{ files: readonly CollabUploadFile[]; failed: boolean }>) {
  const { t } = useTranslation(["collab"]);
  const retrying = useFileNotices((state) => state.retrying);
  const names = formatList(files.map((file) => fileName(file.path)));
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
      <p className="min-w-0 flex-1 select-text" title={files.map((file) => file.path).join("\n")}>
        {message}
      </p>
      <WorkspaceBannerButton
        tone={tone}
        className={failed ? undefined : "text-primary"}
        disabled={retrying}
        onClick={() => void useFileNotices.getState().retry()}
      >
        {retrying ? <Spinner size="xs" /> : null}
        {t(($) => $.collab.files.retry)}
      </WorkspaceBannerButton>
    </WorkspaceBanner>
  );
}

function TooLargeRow({ file }: Readonly<{ file: CollabUploadFile }>) {
  const { t } = useTranslation(["collab"]);
  const name = fileName(file.path);
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
      <p className="min-w-0 flex-1 select-text" title={file.path}>
        {message}
      </p>
      <Dismiss tone="warning" onDismiss={() => useFileNotices.getState().dismissUpload(file.path)} />
    </WorkspaceBanner>
  );
}

function KeptRow({ file, name }: Readonly<{ file: CollabLiveKeptFile; name: string }>) {
  const { t } = useTranslation(["collab"]);
  const values = { name, file: fileName(file.path), copy: fileName(file.copy) };
  const message =
    file.kind === "replaced"
      ? t(($) => $.collab.files.replaced, values)
      : t(($) => $.collab.files.added, values);
  return (
    <WorkspaceBanner tone="primary" data-testid="collab-kept-copy">
      <Files aria-hidden className="size-3.5 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 select-text" title={`${file.path}\n${file.copy}`}>
        {message}
      </p>
      <Dismiss tone="primary" onDismiss={() => useFileNotices.getState().dismissKept(file.id)} />
    </WorkspaceBanner>
  );
}

export function FileNoticesBanner() {
  const { t } = useTranslation(["collab"]);
  const projectId = useFilesStore((state) => state.projectId);
  const notices = useFileNotices(
    useShallow((state) =>
      state.projectId === projectId && projectId !== null
        ? { uploads: state.uploads, kept: state.kept }
        : { uploads: NO_UPLOADS, kept: NO_KEPT },
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
  if (failed.length === 0 && waiting.length === 0 && tooLarge.length === 0 && notices.kept.length === 0) {
    return null;
  }
  const someone = t(($) => $.collab.toolbar.unknownPerson);
  return (
    <div className="flex shrink-0 flex-col">
      {failed.length > 0 ? <UploadRow files={failed} failed /> : null}
      {waiting.length > 0 ? <UploadRow files={waiting} failed={false} /> : null}
      {tooLarge.map((file) => (
        <TooLargeRow key={file.path} file={file} />
      ))}
      {notices.kept.map((file) => (
        <KeptRow key={file.id} file={file} name={(file.by ? names.get(file.by) : undefined) || someone} />
      ))}
    </div>
  );
}
