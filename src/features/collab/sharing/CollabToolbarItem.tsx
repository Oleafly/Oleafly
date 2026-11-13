import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CopyPlus, Share2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useShareDialog } from "@/components/collab/share-dialog";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { isFolderProject } from "@/lib/library-projects";
import { useFilesStore } from "@/store/files";
import { useCollabLiveStore } from "../live/live-store";
import { useCollabStore } from "../store";
import { EditModeSwitch } from "../suggestions/EditModeSwitch";
import { copyThenShare } from "./copy-then-share";
import { PresentAvatars } from "./PresentAvatars";
import { SyncStateIcon, useSyncWords } from "./sync-display";
import { syncState, type SyncState } from "./sync-state";

export function CollabToolbarItem() {
  const projectId = useFilesStore((state) => state.projectId);
  if (!projectId) return null;
  return (
    <>
      <EditModeSwitch projectId={projectId} />
      <PresentAvatars projectId={projectId} data-toolbar-item="collab" />
    </>
  );
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
