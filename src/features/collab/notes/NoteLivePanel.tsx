import { useShallow } from "zustand/react/shallow";
import { NOTE_FILE } from "@/lib/project-notes";
import { useFilesStore } from "@/store/files";
import { useCollabLiveStore } from "../live/live-store";
import type { PresentPerson } from "../sharing/presence";
import { PresentAvatars } from "../sharing/PresentAvatars";
import { SyncStateIcon, useSyncWords } from "../sharing/sync-display";
import { syncState } from "../sharing/sync-state";
import { jumpToNotePeer } from "./note-live-port";

export function NotePresence({ noteId }: Readonly<{ noteId: string }>) {
  const note = useFilesStore(
    useShallow((state) => {
      const project = state.projects.find((entry) => entry.id === noteId);
      return { path: project?.main_doc ?? NOTE_FILE, title: project?.name ?? null };
    }),
  );
  const goTo = (entry: PresentPerson) => (entry.path === note.path ? () => jumpToNotePeer(noteId, entry.accountId) : null);
  const pathLabel = (path: string) => (path === note.path && note.title ? note.title : path);
  return <PresentAvatars projectId={noteId} data-note-presence={noteId} className="pr-1" goTo={goTo} pathLabel={pathLabel} />;
}

export function NoteLiveStatus({ noteId }: Readonly<{ noteId: string }>) {
  const live = useCollabLiveStore(
    useShallow((state) => ({
      status: state.projectId === noteId ? state.status : null,
      pending: state.projectId === noteId ? state.pending : 0,
    })),
  );
  const state = syncState(live.status, live.pending);
  const words = useSyncWords(state, live.pending);
  return (
    <span data-note-live-status={state} aria-live="polite" className="flex items-center gap-1 pr-2 text-xs text-muted-foreground">
      <SyncStateIcon state={state} className="size-3.5" />
      {words}
    </span>
  );
}

export function NoteLivePanel({ noteId, live }: Readonly<{ noteId: string; live: boolean }>) {
  return (
    <>
      <NoteLiveStatus noteId={noteId} />
      {live && <NotePresence noteId={noteId} />}
    </>
  );
}
