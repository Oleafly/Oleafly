import { useMemo } from "react";
import { FileX2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { Spinner } from "@/components/ui/spinner";
import { WorkspaceBanner, WorkspaceBannerButton } from "@/components/ui/workspace-banner";
import { basename } from "@/lib/path-utils";
import { useFilesStore } from "@/store/files";
import { collabErrorMessage } from "../errors";
import { useCollabLiveStore } from "./live-store";
import { PathMessage } from "./PathMessage";
import { type RemovedNotice, useRemovedNotices } from "./removed-notices";

const NONE: readonly RemovedNotice[] = [];

function NoticeRow({
  notice,
  name,
  canRestore,
}: Readonly<{ notice: RemovedNotice; name: string; canRestore: boolean }>) {
  const { t } = useTranslation(["collab"]);
  const restoring = useRemovedNotices((state) => state.restoring);
  const failure = useRemovedNotices((state) => (state.failure?.id === notice.id ? state.failure.code : null));
  const file = basename(notice.path);
  const message = notice.yours
    ? t(($) => $.collab.removed.yoursDeleted, { file, name })
    : t(($) => $.collab.removed.deletedBy, { file, name });
  return (
    <WorkspaceBanner tone="warning" data-testid="collab-removed-notice">
      <FileX2 aria-hidden className="size-3.5 shrink-0" />
      <PathMessage paths={[notice.path]}>{message}</PathMessage>
      <span className="flex shrink-0 items-center gap-1">
        {canRestore ? (
          <WorkspaceBannerButton
            tone="warning"
            disabled={restoring !== null}
            aria-label={t(($) => $.collab.deleted.restoreLabel, { name: file })}
            onClick={() => void useRemovedNotices.getState().restore(notice.id)}
          >
            {restoring === notice.id ? <Spinner size="xs" /> : null}
            {t(($) => $.collab.deleted.restore)}
          </WorkspaceBannerButton>
        ) : null}
        <WorkspaceBannerButton
          tone="warning"
          aria-label={t(($) => $.collab.removed.dismiss)}
          onClick={() => useRemovedNotices.getState().dismiss(notice.id)}
        >
          <X aria-hidden className="size-3.5" />
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

export function RemovedFileBanner() {
  const { t } = useTranslation(["collab"]);
  const projectId = useFilesStore((state) => state.projectId);
  const notices = useRemovedNotices((state) => (state.projectId === projectId ? state.notices : NONE));
  const people = useCollabLiveStore(
    useShallow((state) => ({ members: state.members, role: state.role ?? state.share?.role ?? "viewer" })),
  );
  const names = useMemo(
    () => new Map(people.members.map((member) => [member.person.account_id, member.person.display_name])),
    [people.members],
  );
  if (!projectId || notices.length === 0) return null;
  const someone = t(($) => $.collab.toolbar.unknownPerson);
  return (
    <div className="flex shrink-0 flex-col">
      {notices.map((notice) => (
        <NoticeRow
          key={notice.id}
          notice={notice}
          name={(notice.by ? names.get(notice.by) : undefined) || someone}
          canRestore={people.role !== "viewer"}
        />
      ))}
    </div>
  );
}
