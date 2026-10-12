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
import { peerPlaces, useCollabLiveStore } from "../live/live-store";
import { useCollabStore } from "../store";
import { copyThenShare } from "./copy-then-share";
import { presentPeople, type PresentPerson } from "./presence";
import { SyncStateIcon, useSyncWords } from "./sync-display";
import { syncState, type SyncState } from "./sync-state";

function PersonLines({ entry }: Readonly<{ entry: PresentPerson | undefined }>) {
  const { t } = useTranslation(["collab"]);
  if (!entry) return null;
  const role = entry.role;
  const kind = [role ? t(($) => $.collab.projectRoles[role]) : null, entry.guest ? t(($) => $.collab.guests.badge) : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="flex flex-col text-left">
      <span className="font-medium">{entry.person.name}</span>
      {kind ? <span>{kind}</span> : null}
      <span className="text-muted-foreground">{entry.path ?? t(($) => $.collab.toolbar.noFile)}</span>
    </span>
  );
}

function HiddenPerson({ entry }: Readonly<{ entry: PresentPerson | undefined }>) {
  const { t } = useTranslation(["collab"]);
  if (!entry) return null;
  const role = entry.role;
  const details = [
    role ? t(($) => $.collab.projectRoles[role]) : null,
    entry.guest ? t(($) => $.collab.guests.badge) : null,
    entry.path ?? t(($) => $.collab.toolbar.noFile),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span data-slot="hidden-person" className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap text-left">
      <span className="shrink-0 font-medium">{entry.person.name}</span>
      <span className="truncate text-muted-foreground">{details}</span>
    </span>
  );
}

function PresentAvatars({ projectId }: Readonly<{ projectId: string }>) {
  const { t } = useTranslation(["collab"]);
  const peers = useCollabLiveStore((state) => peerPlaces(state.peers));
  const live = useCollabLiveStore(
    useShallow((state) => ({
      shared: state.projectId === projectId && state.share !== null,
      members: state.members,
      selfId: state.share?.account_id ?? null,
    })),
  );
  const unknownName = t(($) => $.collab.toolbar.unknownPerson);
  const people = useMemo(
    () => presentPeople(peers, live.members, live.selfId, unknownName),
    [peers, live.members, live.selfId, unknownName],
  );
  if (!live.shared || people.length === 0) return null;
  const byId = new Map(people.map((entry) => [entry.accountId, entry]));
  return (
    <div data-toolbar-item="collab" className="flex w-max shrink-0 items-center">
      <AvatarStack
        people={people.map((entry) => entry.person)}
        size="base"
        className="px-0.5"
        renderTip={(person) => <PersonLines entry={byId.get(person.id)} />}
        renderMoreTip={(hidden) => (
          <span className="flex flex-col gap-1">
            {hidden.map((person) => (
              <HiddenPerson key={person.id} entry={byId.get(person.id)} />
            ))}
          </span>
        )}
      />
    </div>
  );
}

export function CollabToolbarItem() {
  const projectId = useFilesStore((state) => state.projectId);
  if (!projectId) return null;
  return <PresentAvatars projectId={projectId} />;
}

function ShareTip({ label, state, words }: Readonly<{ label: string; state: SyncState; words: string }>) {
  return (
    <span className="flex flex-col gap-0.5 text-left">
      <span>{label}</span>
      <span className="flex items-center gap-1 font-normal text-muted-foreground">
        <SyncStateIcon state={state} className="size-3" />
        {words}
      </span>
    </span>
  );
}

export function CollabShareButton() {
  const { t } = useTranslation(["collab"]);
  const projectId = useFilesStore((state) => state.projectId);
  const project = useFilesStore((state) => state.projects.find((entry) => entry.id === state.projectId) ?? null);
  const live = useCollabLiveStore(
    useShallow((state) => ({
      shown: state.projectId === projectId && (state.share !== null || state.status?.state === "ended"),
      status: state.status,
      pending: state.pending,
    })),
  );
  const serversStatus = useCollabStore((state) => state.status);
  const loadServers = useCollabStore((state) => state.load);
  const signedIn = useCollabStore((state) => state.servers.some((entry) => entry.signed_in));
  const linked = project !== null && isFolderProject(project);
  const state = syncState(live.status, live.pending);
  const words = useSyncWords(state, live.pending);

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
    <Tooltip label={live.shown ? <ShareTip label={label} state={state} words={words} /> : label}>
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
  );
}
