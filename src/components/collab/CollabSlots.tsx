import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { lazy } from "@/lib/preloadable";
import { Files, type LucideIcon, MessageSquareQuote, RadioTower } from "lucide-react";
import { MessagesCircle } from "@/components/ui/extra-icons";
import { useTranslation } from "react-i18next";
import type { AnalyzedQuery, FacetState } from "@oleafly/search-query";
import type { ProjectSearchExtension } from "@/components/library/project-search";
import { i18n } from "@/i18n";
import { useLiveBackend } from "@/lib/collab-live-bridge";
import { logError } from "@/lib/log";
import type { QueryMeta } from "@/lib/query-suggestions";
import type { ProjectInfo } from "@/lib/tauri";
import { ToolbarAction } from "@/components/layout/ToolbarAction";
import { Tooltip } from "@/components/ui/tooltip";
import { useFilesStore } from "@/store/files";
import { useHomeViewStore } from "@/store/home-view";
import { useSettingsStore } from "@/store/settings";
import { useChatRail } from "./chat-rail";
import { useCollabReady } from "./collab-ready";
import { useCollabRail } from "./collab-rail";
import { useCommentsRail } from "./comments-rail";
import { useShareDialog } from "./share-dialog";
import { useTreeClashes } from "./tree-clashes";

export interface PeerMark {
  id: string;
  hue: number;
  label: string;
}

export type PeerMarks = ReadonlyMap<string, readonly PeerMark[]>;
export type ProjectQuery = AnalyzedQuery<ProjectInfo, QueryMeta>;
export type CollabTranslate = ReturnType<typeof useTranslation<["collab"]>>["t"];

export interface CollabLibraryKit {
  kind: string;
  share: string;
  copyAndShare: string;
  location: string;
  libraryLocation: string;
  openLink: string;
  extension: ProjectSearchExtension;
  readLocation: (query: ProjectQuery) => FacetState;
  writeLocation: (
    source: string,
    query: ProjectQuery,
    optionId: string | null,
    reanalyze: (source: string) => ProjectQuery,
  ) => string;
}

const surfaces = () => import("@/features/collab/sharing/surfaces");

const CollabToolbarItem = lazy(() => surfaces().then((module) => ({ default: module.CollabToolbarItem })));
const CollabShareButton = lazy(() => surfaces().then((module) => ({ default: module.CollabShareButton })));
const ShareDialog = lazy(() => surfaces().then((module) => ({ default: module.ShareDialog })));
const OverleafLiveButton = lazy(() =>
  import("@/features/collab/sharing/OverleafLiveButton").then((module) => ({ default: module.OverleafLiveButton })),
);
const TreePresence = lazy(() => surfaces().then((module) => ({ default: module.TreePresence })));
const TreeClashes = lazy(() => surfaces().then((module) => ({ default: module.TreeClashes })));
const CollabActivityKeeper = lazy(() => surfaces().then((module) => ({ default: module.CollabActivityKeeper })));
const CollabPane = lazy(() => surfaces().then((module) => ({ default: module.CollabPane })));
const SharedWithYou = lazy(() => surfaces().then((module) => ({ default: module.SharedWithYou })));
const OpenLinkDialog = lazy(() => surfaces().then((module) => ({ default: module.OpenLinkDialog })));
const comments = () => import("@/features/collab/comments");

const CommentsPane = lazy(() => comments().then((module) => ({ default: module.CommentsPane })));
const CommentsKeeper = lazy(() => comments().then((module) => ({ default: module.CommentsKeeper })));
const suggestions = () => import("@/features/collab/suggestions");

const SuggestionsKeeper = lazy(() => suggestions().then((module) => ({ default: module.SuggestionsKeeper })));
const chat = () => import("@/features/collab/chat");

const ChatPane = lazy(() => chat().then((module) => ({ default: module.ChatPane })));
const ChatKeeper = lazy(() => chat().then((module) => ({ default: module.ChatKeeper })));
const CollabBanners = lazy(() =>
  import("@/features/collab/live/SyncPauseBanner").then((module) => ({ default: module.CollabBanners })),
);
const RemovedFileBanner = lazy(() =>
  import("@/features/collab/live/RemovedFileBanner").then((module) => ({ default: module.RemovedFileBanner })),
);
const LinkedFileBanner = lazy(() =>
  import("@/features/collab/live/LinkedFileBanner").then((module) => ({ default: module.LinkedFileBanner })),
);
const NoteLivePanel = lazy(() =>
  import("@/features/collab/notes/NoteLivePanel").then((module) => ({ default: module.NoteLivePanel })),
);
const AdminConsoleWindow = lazy(() =>
  import("@/features/collab/console/AdminConsoleWindow").then((module) => ({ default: module.AdminConsoleWindow })),
);

export { useCollabReady };

export function useCollabLibraryKit(): CollabLibraryKit | null {
  const ready = useCollabReady();
  const { t } = useTranslation(["collab"]);
  const [build, setBuild] = useState<{ kit: (t: CollabTranslate) => CollabLibraryKit } | null>(null);
  useEffect(() => {
    if (!ready || build) return;
    let active = true;
    surfaces().then(
      (module) => {
        if (active) setBuild({ kit: module.libraryKit });
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [ready, build]);
  return useMemo(() => (ready && build ? build.kit(t) : null), [ready, build, t]);
}

function Gate({ when = true, children }: Readonly<{ when?: boolean; children: ReactNode }>) {
  const ready = useCollabReady();
  return ready && when ? <Suspense fallback={null}>{children}</Suspense> : null;
}

export function CollabToolbarSlot() {
  return (
    <Gate>
      <CollabToolbarItem />
    </Gate>
  );
}

export function OverleafLiveSlot() {
  return (
    <Gate>
      <OverleafLiveButton />
    </Gate>
  );
}

export function CollabShareSlot() {
  const projectId = useFilesStore((state) => state.projectId);
  return (
    <Gate when={projectId !== null}>
      <ToolbarAction name="share">
        <CollabShareButton />
      </ToolbarAction>
    </Gate>
  );
}

export function ShareDialogHost({ overNotes = false }: Readonly<{ overNotes?: boolean }>) {
  const projectId = useShareDialog((state) => state.projectId);
  const notesPage = useHomeViewStore((state) => state.page === "notes");
  const notesOn = useSettingsStore((state) => state.notes);
  const notesShown = notesPage && notesOn;
  return (
    <Gate when={projectId !== null && notesShown === overNotes}>
      <ShareDialog key={projectId} projectId={projectId ?? ""} />
    </Gate>
  );
}

export function NoteLiveSlot({ noteId, live }: Readonly<{ noteId: string; live: boolean }>) {
  return (
    <Gate>
      <NoteLivePanel noteId={noteId} live={live} />
    </Gate>
  );
}

export function CollabTreeClashSlot() {
  return (
    <Gate>
      <TreeClashes />
    </Gate>
  );
}

const NO_CLASHES: ReadonlyMap<string, string> = new Map();

export function useTreeClashLabels(): ReadonlyMap<string, string> {
  const ready = useCollabReady();
  const labels = useTreeClashes((state) => state.labels);
  return ready ? labels : NO_CLASHES;
}

export function TreeRowClash({ label }: Readonly<{ label: string | undefined }>) {
  if (!label) return null;
  return (
    <Tooltip label={label} wide>
      <span
        role="img"
        aria-label={label}
        className="flex size-4 shrink-0 items-center justify-center rounded bg-amber-500/15 text-amber-600 dark:text-amber-400"
      >
        <Files aria-hidden className="size-3" />
      </span>
    </Tooltip>
  );
}

export function CollabTreePresenceSlot({ onChange }: Readonly<{ onChange: (marks: PeerMarks) => void }>) {
  return (
    <Gate>
      <TreePresence onChange={onChange} />
    </Gate>
  );
}

export function CollabSyncPauseSlot() {
  return (
    <Gate>
      <CollabBanners />
    </Gate>
  );
}

export function refreshOverleafLinked(projectId: string, path: string): void {
  import("@/features/collab/live/linked-refresh").then(
    (linked) => linked.refreshLinked(projectId, path),
    (error: unknown) => logError("load the linked file refresh", error),
  );
}

export function CollabRemovedFileSlot() {
  const linked = useLiveBackend((state) => state.backend === "overleaf" && state.linked.length > 0);
  return (
    <Gate>
      <RemovedFileBanner />
      {linked ? <LinkedFileBanner /> : null}
    </Gate>
  );
}

export function CollabActivitySlot() {
  const shared = useCollabRail((state) => state.visible);
  const overleaf = useLiveBackend((state) => state.backend === "overleaf");
  return (
    <Gate>
      <CollabActivityKeeper />
      {shared || overleaf ? (
        <Suspense fallback={null}>
          <CommentsKeeper />
          <SuggestionsKeeper />
          <ChatKeeper />
        </Suspense>
      ) : null}
    </Gate>
  );
}

export function CollabPanel() {
  return (
    <Gate>
      <CollabPane />
    </Gate>
  );
}

export function collabRailLabel(): string {
  return useCollabRail.getState().unread
    ? i18n.t(($) => $.collab.pane.titleUnread)
    : i18n.t(($) => $.collab.pane.title);
}

function UnreadRailIcon({
  icon: Icon,
  unread,
  dot,
  className,
}: Readonly<{ icon: LucideIcon; unread: boolean; dot: string; className?: string }>) {
  return (
    <>
      <Icon aria-hidden className={className} />
      {unread ? (
        <span data-testid={dot} aria-hidden className="pointer-events-none absolute right-0.5 top-0.5 flex size-2">
          <span className="absolute inline-flex size-full rounded-full bg-primary opacity-75 motion-safe:animate-ping" />
          <span className="relative inline-flex size-2 rounded-full bg-primary" />
        </span>
      ) : null}
    </>
  );
}

export function CollabRailIcon({ className }: Readonly<{ className?: string }>) {
  const unread = useCollabRail((state) => state.unread);
  return <UnreadRailIcon icon={RadioTower} unread={unread} dot="collab-rail-dot" className={className} />;
}

export function CommentsPanel() {
  return (
    <Gate>
      <CommentsPane />
    </Gate>
  );
}

export function commentsRailLabel(): string {
  return useCommentsRail.getState().unread
    ? i18n.t(($) => $.collab.comments.titleUnread)
    : i18n.t(($) => $.collab.comments.title);
}

export function CommentsRailIcon({ className }: Readonly<{ className?: string }>) {
  const unread = useCommentsRail((state) => state.unread);
  return <UnreadRailIcon icon={MessageSquareQuote} unread={unread} dot="comments-rail-dot" className={className} />;
}

export function ChatPanel() {
  return (
    <Gate>
      <ChatPane />
    </Gate>
  );
}

export function chatRailLabel(): string {
  return useChatRail.getState().unread ? i18n.t(($) => $.collab.chat.titleUnread) : i18n.t(($) => $.collab.chat.title);
}

export function ChatRailIcon({ className }: Readonly<{ className?: string }>) {
  const unread = useChatRail((state) => state.unread);
  return <UnreadRailIcon icon={MessagesCircle} unread={unread} dot="chat-rail-dot" className={className} />;
}

export function SharedWithYouSlot() {
  return (
    <Gate>
      <SharedWithYou />
    </Gate>
  );
}

export function OpenLinkDialogSlot({ open, onClose }: Readonly<{ open: boolean; onClose: () => void }>) {
  return (
    <Gate when={open}>
      <OpenLinkDialog onClose={onClose} />
    </Gate>
  );
}

export function AdminConsoleSlot() {
  return (
    <Gate>
      <AdminConsoleWindow />
    </Gate>
  );
}

export function TreeRowPeers({ marks }: Readonly<{ marks: readonly PeerMark[] | undefined }>) {
  if (!marks || marks.length === 0) return null;
  return (
    <Gate>
      <RowPeers marks={marks} />
    </Gate>
  );
}

function RowPeers({ marks }: Readonly<{ marks: readonly PeerMark[] }>) {
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {marks.map((mark) => (
        <Tooltip key={mark.id} label={mark.label}>
          <span
            role="img"
            aria-label={mark.label}
            className="size-1.5 rounded-full"
            style={{ backgroundColor: `hsl(${mark.hue} 55% 45%)` }}
          />
        </Tooltip>
      ))}
    </span>
  );
}
