import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CopyPlus, Share2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useShareDialog } from "@/components/collab/share-dialog";
import { AvatarStack } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { isFolderProject } from "@/lib/library-projects";
import { useFilesStore } from "@/store/files";
import { useCollabLiveStore } from "../live/live-store";
import { useCollabStore } from "../store";
import { copyThenShare } from "./copy-then-share";
import { openCollabPane } from "./open-pane";
import { presentPeople, type PresentPerson } from "./presence";
import { SyncStateIcon, useSyncWords } from "./sync-display";
import { syncState } from "./sync-state";

function PersonLines({ entry }: Readonly<{ entry: PresentPerson | undefined }>) {
  const { t } = useTranslation(["collab"]);
  if (!entry) return null;
  const role = entry.role;
  return (
    <span className="flex flex-col text-left">
      <span className="font-medium">{entry.person.name}</span>
      {role ? <span>{t(($) => $.collab.projectRoles[role])}</span> : null}
      <span className="text-muted-foreground">{entry.path ?? t(($) => $.collab.toolbar.noFile)}</span>
    </span>
  );
}

function SyncButton() {
  const live = useCollabLiveStore(useShallow((state) => ({ status: state.status, pending: state.pending })));
  const state = syncState(live.status, live.pending);
  const words = useSyncWords(state, live.pending);
  return (
    <Tooltip label={words}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={words}
        className="size-7 hover:text-foreground"
        onClick={openCollabPane}
      >
        <SyncStateIcon state={state} />
      </Button>
    </Tooltip>
  );
}

function PresentAvatars() {
  const { t } = useTranslation(["collab"]);
  const live = useCollabLiveStore(
    useShallow((state) => ({
      peers: state.peers,
      members: state.members,
      selfId: state.share?.account_id ?? null,
    })),
  );
  const unknownName = t(($) => $.collab.toolbar.unknownPerson);
  const people = useMemo(
    () => presentPeople(live.peers, live.members, live.selfId, unknownName),
    [live.peers, live.members, live.selfId, unknownName],
  );
  if (people.length === 0) return null;
  const byId = new Map(people.map((entry) => [entry.accountId, entry]));
  return (
    <AvatarStack
      people={people.map((entry) => entry.person)}
      size="sm"
      className="px-0.5"
      renderTip={(person) => <PersonLines entry={byId.get(person.id)} />}
      renderMoreTip={(hidden) => (
        <span className="flex flex-col gap-1">
          {hidden.map((person) => (
            <PersonLines key={person.id} entry={byId.get(person.id)} />
          ))}
        </span>
      )}
    />
  );
}

export function CollabToolbarItem() {
  const { t } = useTranslation(["collab"]);
  const projectId = useFilesStore((state) => state.projectId);
  const project = useFilesStore((state) => state.projects.find((entry) => entry.id === state.projectId) ?? null);
  const visible = useCollabLiveStore(
    (state) => state.projectId === projectId && (state.share !== null || state.status?.state === "ended"),
  );
  const serversStatus = useCollabStore((state) => state.status);
  const loadServers = useCollabStore((state) => state.load);
  const signedIn = useCollabStore((state) => state.servers.some((entry) => entry.signed_in));
  const linked = project !== null && isFolderProject(project);

  useEffect(() => {
    if (linked && serversStatus === "idle") void loadServers();
  }, [linked, serversStatus, loadServers]);

  if (!projectId) return null;
  const label = linked ? t(($) => $.collab.share.copyAndShare) : t(($) => $.collab.share.button);
  const share = () => {
    if (linked && signedIn) void copyThenShare(projectId, project?.name ?? "");
    else useShareDialog.getState().openFor(projectId);
  };

  return (
    <>
      {visible ? <SyncButton /> : null}
      {visible ? <PresentAvatars /> : null}
      <Tooltip label={label}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          className="size-7 text-muted-foreground hover:text-foreground"
          onClick={share}
        >
          {linked ? <CopyPlus aria-hidden className="size-4" /> : <Share2 aria-hidden className="size-4" />}
        </Button>
      </Tooltip>
    </>
  );
}
