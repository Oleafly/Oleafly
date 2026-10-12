import { memo, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type SVGProps } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Archive,
  CloudCheck,
  CloudOff,
  GitMerge,
  LogOut,
  MonitorSmartphone,
  RadioTower,
  Share2,
  UserCog,
  UserMinus,
  UserPlus,
  Users,
  UserX,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useShareDialog } from "@/components/collab/share-dialog";
import { SidebarPanelHeader, SidebarSection } from "@/components/layout/SidebarSection";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { formatDateTime, formatNumber, formatRelativeTimeFrom } from "@/lib/intl";
import type { CollabProjectMember } from "@/lib/tauri";
import { useSidebarViewMemory } from "@/hooks/use-sidebar-view-memory";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { readSidebarView } from "@/store/sidebar-view-state";
import { peerPlaces, useCollabLiveStore, type PeerPlaces } from "../live/live-store";
import { collabPerson } from "../people";
import { peerHue } from "../live/peer-hue";
import { useCollabActivity, type ActivityEntry } from "./activity-store";
import { MergeReviewDialog } from "./MergeReviewDialog";
import { SyncStateIcon, useSyncWords } from "./sync-display";
import { syncState } from "./sync-state";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const ACTIVITY_ICONS: Readonly<Record<ActivityEntry["kind"], Icon>> = {
  welcome: Users,
  joined: UserPlus,
  left: UserMinus,
  offline: CloudOff,
  online: CloudCheck,
  merged: GitMerge,
  role: UserCog,
  removed: UserX,
  archived: Archive,
  signedOut: LogOut,
  newDevice: MonitorSmartphone,
};

const TICK_MS = 60_000;

const OPEN_SECTIONS = { people: true, activity: true };

function openCollaborationSettings() {
  const settings = useSettingsStore.getState();
  settings.setSettingsInitialSection("collaboration");
  settings.setSettingsOpen(true);
}

function presencePaths(peers: PeerPlaces): Map<string, string | null> {
  const paths = new Map<string, string | null>();
  for (const peer of Object.values(peers)) {
    if (!paths.get(peer.accountId)) paths.set(peer.accountId, peer.path);
  }
  return paths;
}

const People = memo(function People({
  title,
  members,
  selfId,
}: Readonly<{
  title: string;
  members: readonly CollabProjectMember[];
  selfId: string | null;
}>) {
  const { t } = useTranslation(["collab"]);
  const peers = useCollabLiveStore((state) => peerPlaces(state.peers));
  const here = presencePaths(peers);
  const ordered = [...members].sort(
    (a, b) => Number(b.person.account_id === selfId) - Number(a.person.account_id === selfId),
  );
  const whereabouts = (accountId: string) => {
    if (!here.has(accountId)) return t(($) => $.collab.pane.away);
    const path = here.get(accountId);
    return path ? t(($) => $.collab.pane.hereIn, { path }) : t(($) => $.collab.pane.here);
  };
  return (
    <ul aria-label={title} className="space-y-0.5">
      {ordered.map((member) => {
        const accountId = member.person.account_id;
        const self = accountId === selfId;
        return (
          <li key={accountId} className="flex items-center gap-2 rounded-md px-1 py-1">
            <Avatar person={{ ...collabPerson(member.person), hue: peerHue(accountId, selfId) }} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="flex min-w-0 items-center gap-1.5 text-xs">
                <span className="truncate font-medium">{member.person.display_name}</span>
                {self ? (
                  <Badge variant="primaryGhost" size="sm">
                    {t(($) => $.collab.manage.you)}
                  </Badge>
                ) : null}
              </p>
              <p className="truncate text-[0.6875rem] text-muted-foreground">
                {t(($) => $.collab.projectRoles[member.role])}
                {self ? null : ` · ${whereabouts(accountId)}`}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
});

function entryText(entry: ActivityEntry, t: ReturnType<typeof useTranslation<["collab"]>>["t"], unknown: string) {
  switch (entry.kind) {
    case "welcome":
      return entry.role === "editor"
        ? t(($) => $.collab.activity.welcomeEdit, { owner: entry.owner, server: entry.server })
        : t(($) => $.collab.activity.welcomeView, { owner: entry.owner, server: entry.server });
    case "joined":
      return t(($) => $.collab.activity.joined, { name: entry.name || unknown });
    case "left":
      return t(($) => $.collab.activity.left, { name: entry.name || unknown });
    case "offline":
      return t(($) => $.collab.sync.offline, { number: formatNumber(entry.pending) });
    case "online":
      return t(($) => $.collab.activity.online);
    case "merged":
      return t(($) => $.collab.activity.merged, {
        number: formatNumber(entry.files.reduce((sum, file) => sum + file.changes, 0)),
      });
    case "role": {
      const role = entry.role;
      return t(($) => $.collab.activity.role, { role: t(($) => $.collab.projectRoles[role]) });
    }
    case "removed":
      return t(($) => $.collab.activity.removed);
    case "archived":
      return t(($) => $.collab.activity.archived);
    case "signedOut":
      return t(($) => $.collab.activity.signedOut, { server: entry.server });
    case "newDevice":
      return t(($) => $.collab.activity.newDevice, { name: entry.name || unknown });
  }
}

const ActivityRow = memo(function ActivityRow({ entry, now }: Readonly<{ entry: ActivityEntry; now: number }>) {
  const { t } = useTranslation(["collab"]);
  const [open, setOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const projectId = useCollabActivity((state) => state.projectId);
  const Glyph = ACTIVITY_ICONS[entry.kind];
  return (
    <li className="flex gap-2 rounded-md px-1 py-1.5 text-xs">
      <Glyph aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="select-text">{entryText(entry, t, t(($) => $.collab.toolbar.unknownPerson))}</p>
        {entry.count > 1 ? (
          <p className="text-muted-foreground">
            {t(($) => $.collab.activity.repeated, { number: formatNumber(entry.count) })}
          </p>
        ) : null}
        {entry.kind === "merged" && open ? (
          <ul className="space-y-0.5 font-mono text-muted-foreground">
            {entry.files.map((file) => (
              <li key={file.path} className="truncate">
                {t(($) => $.collab.activity.mergedFile, { path: file.path, number: formatNumber(file.changes) })}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
          <time dateTime={new Date(entry.at).toISOString()} title={formatDateTime(entry.at)}>
            {formatRelativeTimeFrom(entry.at, now)}
          </time>
          {entry.kind === "merged" && entry.files.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              {open ? t(($) => $.collab.activity.hideFiles) : t(($) => $.collab.activity.showFiles)}
            </Button>
          ) : null}
          {entry.kind === "merged" && entry.review && projectId ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs"
              onClick={() => setReviewing(true)}
            >
              {t(($) => $.collab.activity.review)}
            </Button>
          ) : null}
          {entry.kind === "signedOut" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs"
              onClick={openCollaborationSettings}
            >
              {t(($) => $.collab.activity.signIn)}
            </Button>
          ) : null}
        </div>
      </div>
      {reviewing && entry.kind === "merged" && projectId ? (
        <MergeReviewDialog projectId={projectId} entry={entry} onClose={() => setReviewing(false)} />
      ) : null}
    </li>
  );
});

const ActivityList = memo(function ActivityList({
  title,
  entries,
}: Readonly<{ title: string; entries: readonly ActivityEntry[] }>) {
  const { t } = useTranslation(["collab"]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  if (entries.length === 0) {
    return <p className="px-1 text-xs text-muted-foreground">{t(($) => $.collab.pane.empty)}</p>;
  }
  return (
    <ul aria-label={title} className="space-y-0.5">
      {entries.map((entry) => (
        <ActivityRow key={entry.id} entry={entry} now={now} />
      ))}
    </ul>
  );
});

function useSectionOpen(projectId: string | null) {
  const [sectionOpen, setSectionOpen] = useState(
    () => readSidebarView(projectId, "collab")?.sectionOpen ?? OPEN_SECTIONS,
  );
  useSidebarViewMemory(projectId, "collab", { sectionOpen });
  const previousProjectId = useRef(projectId);
  useLayoutEffect(() => {
    if (previousProjectId.current === projectId) return;
    previousProjectId.current = projectId;
    setSectionOpen(readSidebarView(projectId, "collab")?.sectionOpen ?? OPEN_SECTIONS);
  }, [projectId]);
  return [sectionOpen, setSectionOpen] as const;
}

export function CollabPane() {
  const { t } = useTranslation(["collab"]);
  const live = useCollabLiveStore(
    useShallow((state) => ({
      projectId: state.projectId,
      share: state.share,
      status: state.status,
      pending: state.pending,
      members: state.members,
    })),
  );
  const entries = useCollabActivity((state) => state.entries);
  const unread = useCollabActivity((state) => state.unread);
  const showTree = useSettingsStore((state) => state.showTree);
  const filesProjectId = useFilesStore((state) => state.projectId);
  const [sectionOpen, setSectionOpen] = useSectionOpen(filesProjectId);
  const state = syncState(live.status, live.pending);
  const words = useSyncWords(state, live.pending);
  const manage = t(($) => $.collab.pane.manage);
  const peopleTitle = t(($) => $.collab.pane.people);
  const activityTitle = t(($) => $.collab.pane.activity);
  const projectId = live.projectId;

  useEffect(() => {
    if (showTree && unread) useCollabActivity.getState().markRead();
  }, [showTree, unread]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="collab-pane">
      <SidebarPanelHeader icon={RadioTower} title={t(($) => $.collab.pane.title)}>
        {live.share && projectId ? (
          <Tooltip label={manage}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={manage}
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={() => useShareDialog.getState().openFor(projectId)}
            >
              <Share2 aria-hidden className="size-3.5" />
            </Button>
          </Tooltip>
        ) : null}
      </SidebarPanelHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-0.5 border-b border-sidebar-border px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <p className="flex min-w-0 flex-1 items-center gap-2 font-medium">
              <SyncStateIcon state={state} className="size-3.5" />
              <span>{words}</span>
            </p>
            {state === "signedOut" ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 shrink-0 px-1.5 text-xs"
                onClick={openCollaborationSettings}
              >
                {t(($) => $.collab.activity.signIn)}
              </Button>
            ) : null}
          </div>
          {live.share ? (
            <p className="truncate text-muted-foreground">
              {t(($) => $.collab.manage.sharedOn, { server: live.share.server_name })}
            </p>
          ) : null}
        </div>
        {live.members.length > 0 ? (
          <SidebarSection
            id="collab-people"
            title={peopleTitle}
            icon={<Users aria-hidden className="size-3.5" />}
            count={live.members.length}
            open={sectionOpen.people}
            onOpenChange={(open) => setSectionOpen((value) => ({ ...value, people: open }))}
            contentClassName="px-2 py-1"
          >
            <People title={peopleTitle} members={live.members} selfId={live.share?.account_id ?? null} />
          </SidebarSection>
        ) : null}
        <SidebarSection
          id="collab-activity"
          title={activityTitle}
          icon={<Activity aria-hidden className="size-3.5" />}
          count={entries.length}
          open={sectionOpen.activity}
          onOpenChange={(open) => setSectionOpen((value) => ({ ...value, activity: open }))}
          contentClassName="px-2 py-1"
        >
          <ActivityList title={activityTitle} entries={entries} />
        </SidebarSection>
      </div>
    </div>
  );
}
