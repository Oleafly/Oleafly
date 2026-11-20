import { useMemo } from "react";
import { FileX2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { Spinner } from "@/components/ui/spinner";
import { WorkspaceBanner, WorkspaceBannerAlert, WorkspaceBannerButton } from "@/components/ui/workspace-banner";
import { basename } from "@/lib/path-utils";
import { useFilesStore } from "@/store/files";
import { collabErrorMessage } from "../errors";
import { canEditProjectRole } from "../roles";
import { DismissButton } from "./DismissButton";
import { useCollabLiveStore } from "./live-store";
import { PathMessage } from "./PathMessage";
import { type RemovedNotice, useRemovedNotices } from "./removed-notices";

const NONE: readonly RemovedNotice[] = [];

function NoticeRow({
  notice,
  name,
  canRestore,
  online,
}: Readonly<{ notice: RemovedNotice; name: string; canRestore: boolean; online: boolean }>) {
  const { t } = useTranslation(["collab"]);
  const restoring = useRemovedNotices((state) => state.restoring);
  const failure = useRemovedNotices((state) => (state.failure?.id === notice.id ? state.failure.code : null));
  const file = basename(notice.path);
  let message: string;
  if (notice.copy) message = t(($) => $.collab.removed.keptCopy, { file, name, copy: basename(notice.copy) });
  else if (online) message = t(($) => $.collab.removed.deletedOnline, { file, name });
  else if (notice.yours) message = t(($) => $.collab.removed.yoursDeleted, { file, name });
  else message = t(($) => $.collab.removed.deletedBy, { file, name });
  return (
    <WorkspaceBanner tone="warning" data-testid="collab-removed-notice">
      <FileX2 aria-hidden className="size-3.5 shrink-0" />
      <PathMessage paths={[notice.path]}>{message}</PathMessage>
      <span className="flex shrink-0 items-center gap-1">
        {canRestore ? (
          <WorkspaceBannerButton
            tone="warning"
            disabled={restoring !== null}
            aria-label={
              online
                ? t(($) => $.collab.removed.restoreOnlineLabel, { name: file })
                : t(($) => $.collab.deleted.restoreLabel, { name: file })
            }
            onClick={() => void useRemovedNotices.getState().restore(notice.id)}
          >
            {restoring === notice.id ? <Spinner size="xs" /> : null}
            {online ? t(($) => $.collab.removed.restoreOnline) : t(($) => $.collab.deleted.restore)}
          </WorkspaceBannerButton>
        ) : null}
        <DismissButton
          tone="warning"
          label={t(($) => $.collab.removed.dismiss)}
          onDismiss={() => useRemovedNotices.getState().dismiss(notice.id)}
        />
      </span>
      {failure ? (
        <WorkspaceBannerAlert>{collabErrorMessage(failure)}</WorkspaceBannerAlert>
      ) : null}
    </WorkspaceBanner>
  );
}

export function RemovedFileBanner() {
  const { t } = useTranslation(["collab"]);
  const projectId = useFilesStore((state) => state.projectId);
  const notices = useRemovedNotices((state) => (state.projectId === projectId ? state.notices : NONE));
  const people = useCollabLiveStore(
    useShallow((state) => ({
      members: state.members,
      role: state.role ?? state.share?.role ?? "viewer",
      online: state.backend === "overleaf",
    })),
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
          canRestore={canEditProjectRole(people.role) && (!people.online || Boolean(notice.copy))}
          online={people.online}
        />
      ))}
    </div>
  );
}
