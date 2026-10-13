import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Files, MessageSquare, RadioTower } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AnalyzedQuery, FacetState } from "@oleafly/search-query";
import type { ProjectSearchExtension } from "@/components/library/project-search";
import { i18n, loadNamespace } from "@/i18n";
import type { QueryMeta } from "@/lib/query-suggestions";
import type { ProjectInfo } from "@/lib/tauri";
import { ToolbarAction } from "@/components/layout/ToolbarAction";
import { Tooltip } from "@/components/ui/tooltip";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
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
const TreePresence = lazy(() => surfaces().then((module) => ({ default: module.TreePresence })));
const TreeClashes = lazy(() => surfaces().then((module) => ({ default: module.TreeClashes })));
const CollabActivityKeeper = lazy(() => surfaces().then((module) => ({ default: module.CollabActivityKeeper })));
const CollabPane = lazy(() => surfaces().then((module) => ({ default: module.CollabPane })));
const SharedWithYou = lazy(() => surfaces().then((module) => ({ default: module.SharedWithYou })));
const OpenLinkDialog = lazy(() => surfaces().then((module) => ({ default: module.OpenLinkDialog })));
const comments = () => import("@/features/collab/comments");

const CommentsPane = lazy(() => comments().then((module) => ({ default: module.CommentsPane })));
const CommentsKeeper = lazy(() => comments().then((module) => ({ default: module.CommentsKeeper })));
const CollabBanners = lazy(() =>
  import("@/features/collab/live/SyncPauseBanner").then((module) => ({ default: module.CollabBanners })),
);
const RemovedFileBanner = lazy(() =>
  import("@/features/collab/live/RemovedFileBanner").then((module) => ({ default: module.RemovedFileBanner })),
);
const AdminConsoleWindow = lazy(() =>
  import("@/features/collab/console/AdminConsoleWindow").then((module) => ({ default: module.AdminConsoleWindow })),
);

export function useCollabReady(): boolean {
  const enabled = useSettingsStore((state) => state.liveCollaboration);
  const [loaded, setLoaded] = useState(() => i18n.hasResourceBundle("en", "collab"));
  useEffect(() => {
    if (!enabled || loaded) return;
    let active = true;
    loadNamespace("collab").then(
      () => {
        if (active) setLoaded(true);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [enabled, loaded]);
  return enabled && loaded;
}

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

export function ShareDialogHost() {
  const projectId = useShareDialog((state) => state.projectId);
  return (
    <Gate when={projectId !== null}>
      <ShareDialog key={projectId} projectId={projectId ?? ""} />
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

export function TreeRowClash({ path }: Readonly<{ path: string }>) {
  return (
    <Gate>
      <RowClash path={path} />
    </Gate>
  );
}

function RowClash({ path }: Readonly<{ path: string }>) {
  const label = useTreeClashes((state) => state.labels.get(path));
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

export function CollabRemovedFileSlot() {
  return (
    <Gate>
      <RemovedFileBanner />
    </Gate>
  );
}

export function CollabActivitySlot() {
  const shared = useCollabRail((state) => state.visible);
  return (
    <Gate>
      <CollabActivityKeeper />
      {shared ? (
        <Suspense fallback={null}>
          <CommentsKeeper />
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

export function CollabRailIcon({ className }: Readonly<{ className?: string }>) {
  const unread = useCollabRail((state) => state.unread);
  return (
    <>
      <RadioTower aria-hidden className={className} />
      {unread ? (
        <span data-testid="collab-rail-dot" aria-hidden className="pointer-events-none absolute right-0.5 top-0.5 flex size-2">
          <span className="absolute inline-flex size-full rounded-full bg-primary opacity-75 motion-safe:animate-ping" />
          <span className="relative inline-flex size-2 rounded-full bg-primary" />
        </span>
      ) : null}
    </>
  );
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
  return (
    <>
      <MessageSquare aria-hidden className={className} />
      {unread ? (
        <span data-testid="comments-rail-dot" aria-hidden className="pointer-events-none absolute right-0.5 top-0.5 flex size-2">
          <span className="absolute inline-flex size-full rounded-full bg-primary opacity-75 motion-safe:animate-ping" />
          <span className="relative inline-flex size-2 rounded-full bg-primary" />
        </span>
      ) : null}
    </>
  );
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
