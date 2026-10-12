import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { RadioTower } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AnalyzedQuery, FacetState } from "@oleafly/search-query";
import type { ProjectSearchExtension } from "@/components/library/project-search";
import { i18n, loadNamespace } from "@/i18n";
import type { QueryMeta } from "@/lib/query-suggestions";
import type { ProjectInfo } from "@/lib/tauri";
import { ToolbarAction } from "@/components/layout/ToolbarAction";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { useCollabRail } from "./collab-rail";
import { useShareDialog } from "./share-dialog";

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
const CollabActivityKeeper = lazy(() => surfaces().then((module) => ({ default: module.CollabActivityKeeper })));
const CollabPane = lazy(() => surfaces().then((module) => ({ default: module.CollabPane })));
const SharedWithYou = lazy(() => surfaces().then((module) => ({ default: module.SharedWithYou })));
const OpenLinkDialog = lazy(() => surfaces().then((module) => ({ default: module.OpenLinkDialog })));

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

export function CollabTreePresenceSlot({ onChange }: Readonly<{ onChange: (marks: PeerMarks) => void }>) {
  return (
    <Gate>
      <TreePresence onChange={onChange} />
    </Gate>
  );
}

export function CollabActivitySlot() {
  return (
    <Gate>
      <CollabActivityKeeper />
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

export function TreeRowPeers({ marks }: Readonly<{ marks: readonly PeerMark[] | undefined }>) {
  if (!marks || marks.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {marks.map((mark) => (
        <span
          key={mark.id}
          role="img"
          aria-label={mark.label}
          title={mark.label}
          className="size-1.5 rounded-full"
          style={{ backgroundColor: `hsl(${mark.hue} 55% 45%)` }}
        />
      ))}
    </span>
  );
}
