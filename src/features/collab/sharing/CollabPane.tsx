import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  Archive,
  AtSign,
  Ban,
  CircleArrowUp,
  CloudCheck,
  CloudOff,
  GitMerge,
  LogOut,
  MonitorSmartphone,
  PencilLine,
  RadioTower,
  Replace,
  ServerCog,
  Share2,
  SlidersHorizontal,
  TriangleAlert,
  UserCog,
  UserLock,
  UserMinus,
  UserPlus,
  UserRoundMinus,
  UserRoundPlus,
  Users,
  UserX,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { openCommentThread } from "@/components/collab/comments-rail";
import { useShareDialog } from "@/components/collab/share-dialog";
import { SidebarPanelHeader, SidebarSection } from "@/components/layout/SidebarSection";
import { SidebarSectionStack, type StackSection } from "@/components/layout/SidebarSectionStack";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverClose } from "@/components/ui/popover";
import { Tooltip } from "@/components/ui/tooltip";
import { formatDateTime, formatNumber, formatRelativeTimeFrom } from "@/lib/intl";
import { collabLeaveProject, type CollabProjectMember } from "@/lib/tauri";
import { openUpdateWindow } from "@/lib/updater";
import { useSidebarViewMemory } from "@/hooks/use-sidebar-view-memory";
import { useFilesStore } from "@/store/files";
import { useSettingsStore } from "@/store/settings";
import { readSidebarView } from "@/store/sidebar-view-state";
import { collabErrorText } from "../errors";
import { InlineAlert } from "../feedback";
import { goToPerson } from "../live/go-to-person";
import { peerPlaces, useCollabLiveStore, type PeerPlaces } from "../live/live-store";
import { GuestBadge } from "../GuestBadge";
import { collabPerson } from "../people";
import { peerHue } from "../live/peer-hue";
import { AccessLog, useAccessLogShown } from "./AccessLog";
import { useCollabActivity, type ActivityEntry } from "./activity-store";
import { MergeReviewDialog } from "./MergeReviewDialog";
import { RecentlyDeleted } from "./RecentlyDeleted";
import { settingActivityText } from "./setting-activity";
import { middleEllipsisPath } from "./middle-ellipsis";
import { SyncStateIcon, useSyncWords } from "./sync-display";
import { syncState, type SyncState } from "./sync-state";

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
  suspended: UserLock,
  accessEnded: Ban,
  clientTooOld: CircleArrowUp,
  serverTooOld: ServerCog,
  serverChanged: Replace,
  memberAdded: UserRoundPlus,
  memberRemoved: UserRoundMinus,
  newDevice: MonitorSmartphone,
  renamed: PencilLine,
  mentioned: AtSign,
  setting: SlidersHorizontal,
  skipped: TriangleAlert,
};

const TICK_MS = 60_000;

const OPEN_SECTIONS = { people: true, activity: true, deleted: false, accessLog: false };

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

function PersonRow({
  member,
  selfId,
  details,
  goTo,
}: Readonly<{
  member: CollabProjectMember;
  selfId: string | null;
  details: ReactNode;
  goTo: string | null;
}>) {
  const { t } = useTranslation(["collab"]);
  const describedBy = useId();
  const accountId = member.person.account_id;
  const self = accountId === selfId;
  const content = (
    <>
      <Avatar person={{ ...collabPerson(member.person), hue: peerHue(accountId, selfId) }} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-xs">
          <span className="truncate font-medium">{member.person.display_name}</span>
          {member.person.guest ? <GuestBadge /> : null}
          {self ? (
            <Badge variant="primaryGhost" size="sm">
              {t(($) => $.collab.manage.you)}
            </Badge>
          ) : null}
        </p>
        <p id={describedBy} className="truncate text-[0.6875rem] text-muted-foreground">
          {t(($) => $.collab.projectRoles[member.role])}
          {self ? null : <> · {details}</>}
        </p>
      </div>
    </>
  );
  return (
    <li className={goTo ? "flex" : "flex items-center gap-2 rounded-md px-1 py-1"}>
      {goTo ? (
        <button
          type="button"
          aria-label={goTo}
          aria-describedby={describedBy}
          onClick={() => void goToPerson(accountId)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-accent focus-visible:bg-accent"
        >
          {content}
        </button>
      ) : (
        content
      )}
    </li>
  );
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
    if (!here.has(accountId)) return <span>{t(($) => $.collab.pane.away)}</span>;
    const path = here.get(accountId);
    if (!path) return <span>{t(($) => $.collab.pane.here)}</span>;
    return (
      <Tooltip label={t(($) => $.collab.pane.hereIn, { path })} wide className="inline">
        {t(($) => $.collab.pane.hereIn, { path: middleEllipsisPath(path, PANE_PATH_CHARS) })}
      </Tooltip>
    );
  };
  return (
    <ul aria-label={title} className="space-y-0.5">
      {ordered.map((member) => {
        const accountId = member.person.account_id;
        const self = accountId === selfId;
        return (
          <PersonRow
            key={accountId}
            member={member}
            selfId={selfId}
            details={self ? null : whereabouts(accountId)}
            goTo={
              !self && here.get(accountId)
                ? t(($) => $.collab.toolbar.goTo, { name: member.person.display_name })
                : null
            }
          />
        );
      })}
    </ul>
  );
});

type MemberEntry = Extract<ActivityEntry, { kind: "memberAdded" | "memberRemoved" }>;

function memberText(entry: MemberEntry, t: ReturnType<typeof useTranslation<["collab"]>>["t"], unknown: string) {
  const name = entry.name || unknown;
  const by = entry.by || unknown;
  const own = entry.accountId === entry.byAccountId;
  if (entry.kind === "memberAdded") {
    if (entry.byYou) return t(($) => $.collab.activity.memberAddedByYou, { name });
    if (own) return t(($) => $.collab.activity.memberJoined, { name });
    return t(($) => $.collab.activity.memberAdded, { by, name });
  }
  if (entry.byYou) return t(($) => $.collab.activity.memberRemovedByYou, { name });
  if (own) return t(($) => $.collab.activity.memberLeft, { name });
  return t(($) => $.collab.activity.memberRemoved, { by, name });
}

function entryText(entry: ActivityEntry, t: ReturnType<typeof useTranslation<["collab"]>>["t"], unknown: string) {
  switch (entry.kind) {
    case "welcome":
      return entry.role === "editor"
        ? t(($) => $.collab.activity.welcomeEdit, { owner: entry.owner, server: entry.server })
        : t(($) => $.collab.activity.welcomeView, { owner: entry.owner, server: entry.server });
    case "joined":
      return entry.count > 1
        ? t(($) => $.collab.activity.rejoined, { name: entry.name || unknown })
        : t(($) => $.collab.activity.joined, { name: entry.name || unknown });
    case "left":
      return entry.count > 1
        ? t(($) => $.collab.activity.visited, { name: entry.name || unknown })
        : t(($) => $.collab.activity.left, { name: entry.name || unknown });
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
      return entry.by
        ? t(($) => $.collab.activity.removedBy, { name: entry.by })
        : t(($) => $.collab.activity.removed);
    case "archived":
      return t(($) => $.collab.activity.archived);
    case "signedOut":
      return t(($) => $.collab.activity.signedOut, { server: entry.server });
    case "suspended":
      return t(($) => $.collab.activity.suspended, { server: entry.server });
    case "clientTooOld":
      return t(($) => $.collab.activity.clientTooOld, { server: entry.server });
    case "serverTooOld":
      return t(($) => $.collab.activity.serverTooOld, { server: entry.server });
    case "serverChanged":
      return t(($) => $.collab.activity.serverChanged, { server: entry.server });
    case "accessEnded":
      return entry.guest
        ? t(($) => $.collab.activity.accessEndedGuest, { server: entry.server })
        : t(($) => $.collab.activity.accessEnded, { server: entry.server });
    case "memberAdded":
    case "memberRemoved":
      return memberText(entry, t, unknown);
    case "newDevice":
      return t(($) => $.collab.activity.newDevice, { name: entry.name || unknown });
    case "renamed":
      return t(($) => $.collab.activity.renamed, {
        name: entry.name || unknown,
        before: entry.before,
        ours: entry.ours,
        theirs: entry.theirs,
      });
    case "mentioned":
      return entry.path
        ? t(($) => $.collab.activity.mentioned, { name: entry.name || unknown, path: entry.path })
        : t(($) => $.collab.activity.mentionedHere, { name: entry.name || unknown });
    case "setting":
      return settingActivityText(entry.change, entry.name || unknown, t);
    case "skipped":
      return entry.name
        ? t(($) => $.collab.activity.skipped, { name: entry.name })
        : t(($) => $.collab.activity.skippedUnknown);
  }
}

function checkForUpdates() {
  void openUpdateWindow({ manual: true });
}

const ActivityRow = memo(function ActivityRow({ entry, now }: Readonly<{ entry: ActivityEntry; now: number }>) {
  const { t } = useTranslation(["collab", "shell"]);
  const [open, setOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const projectId = useCollabActivity((state) => state.projectId);
  const Glyph = ACTIVITY_ICONS[entry.kind];
  return (
    <li className="flex gap-2 rounded-md px-1 py-1.5 text-xs">
      <Glyph aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="select-text">{entryText(entry, t, t(($) => $.collab.toolbar.unknownPerson))}</p>
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
          <Tooltip label={formatDateTime(entry.at)}>
            <time dateTime={new Date(entry.at).toISOString()}>{formatRelativeTimeFrom(entry.at, now)}</time>
          </Tooltip>
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
          {entry.kind === "signedOut" || entry.kind === "suspended" ? (
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
          {entry.kind === "clientTooOld" ? (
            <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={checkForUpdates}>
              {t(($) => $.shell.updateChecker.check)}
            </Button>
          ) : null}
          {entry.kind === "serverChanged" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs"
              onClick={openCollaborationSettings}
            >
              {t(($) => $.collab.share.openSettings)}
            </Button>
          ) : null}
          {entry.kind === "mentioned" && entry.path ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs"
              onClick={() => entry.path && openCommentThread(entry.path, entry.threadId)}
            >
              {t(($) => $.collab.activity.showComment)}
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

// The project's server is no longer in the list, so signing in can't help.
// Leaving makes the project an ordinary one on this computer.
function ServerRemovedActions({ projectId }: Readonly<{ projectId: string }>) {
  const { t } = useTranslation(["collab"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keep = async () => {
    setBusy(true);
    setError(null);
    try {
      await collabLeaveProject(projectId);
      await useCollabLiveStore.getState().refreshShare();
    } catch (error_) {
      setError(collabErrorText(error_));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground">{t(($) => $.collab.errors.server_removed)}</p>
      <div className="flex flex-wrap gap-1.5">
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void keep()}>
          {t(($) => $.collab.section.server.unsent.keep)}
        </Button>
        <PopoverClose asChild>
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={openCollaborationSettings}>
            {t(($) => $.collab.share.openSettings)}
          </Button>
        </PopoverClose>
      </div>
      {error ? <InlineAlert>{error}</InlineAlert> : null}
    </div>
  );
}

// Why syncing stopped for good, and what the person can do about it.
function EndedDetails({ state, server }: Readonly<{ state: SyncState; server: string }>) {
  const { t } = useTranslation(["collab", "shell"]);
  const button = "h-7 text-xs";
  if (state === "clientTooOld") {
    return (
      <>
        <p className="text-muted-foreground">{t(($) => $.collab.activity.clientTooOld, { server })}</p>
        <PopoverClose asChild>
          <Button type="button" variant="outline" size="sm" className={button} onClick={checkForUpdates}>
            {t(($) => $.shell.updateChecker.check)}
          </Button>
        </PopoverClose>
      </>
    );
  }
  if (state === "serverTooOld") {
    return <p className="text-muted-foreground">{t(($) => $.collab.activity.serverTooOld, { server })}</p>;
  }
  if (state === "serverChanged") {
    return (
      <>
        <p className="text-muted-foreground">{t(($) => $.collab.activity.serverChanged, { server })}</p>
        <PopoverClose asChild>
          <Button type="button" variant="outline" size="sm" className={button} onClick={openCollaborationSettings}>
            {t(($) => $.collab.share.openSettings)}
          </Button>
        </PopoverClose>
      </>
    );
  }
  return null;
}

function SyncStatus() {
  const { t } = useTranslation(["collab"]);
  const live = useCollabLiveStore(
    useShallow((state) => ({
      status: state.status,
      pending: state.pending,
      share: state.share,
      role: state.role ?? state.share?.role ?? null,
    })),
  );
  const state = syncState(live.status, live.pending);
  const words = useSyncWords(state, live.pending);
  const role = live.role;
  return (
    <Popover
      openOnHover
      closeOnClick={false}
      align="right"
      ariaLabel={words}
      contentAriaLabel={t(($) => $.collab.pane.status)}
      triggerClassName="size-6 p-0 hover:text-foreground [&_svg]:size-3.5"
      trigger={<SyncStateIcon state={state} />}
      className="w-64 p-3"
    >
      <div className="space-y-2 text-xs">
        <p className="flex items-start gap-2 font-medium">
          <SyncStateIcon state={state} className="mt-0.5 size-3.5" />
          <span className="min-w-0 break-words">{words}</span>
        </p>
        {state === "signedOut" || state === "suspended" ? (
          <PopoverClose asChild>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={openCollaborationSettings}>
              {t(($) => $.collab.activity.signIn)}
            </Button>
          </PopoverClose>
        ) : null}
        {state === "serverRemoved" && live.share ? <ServerRemovedActions projectId={live.share.project_id} /> : null}
        <EndedDetails state={state} server={live.share?.server_name ?? ""} />
        {live.share ? (
          <div className="space-y-0.5 border-t pt-2 text-muted-foreground">
            {live.share.server_name ? (
              <p className="break-words font-medium text-foreground">
                {t(($) => $.collab.manage.sharedOn, { server: live.share.server_name })}
              </p>
            ) : null}
            <p className="select-text break-all">{live.share.server_url}</p>
            {role ? <p>{t(($) => $.collab.manage.yourRole, { role: t(($) => $.collab.projectRoles[role]) })}</p> : null}
            <p className="tabular-nums">{t(($) => $.collab.pane.waiting, { number: formatNumber(live.pending) })}</p>
          </div>
        ) : null}
      </div>
    </Popover>
  );
}

const COLLAB_GROUP_ID = "sidebar-collab-sections-v1";
const SECTION_OPEN = "h-full flex-1";
const SECTION_SHUT = "shrink-0";
const SECTION_SCROLL = "min-h-0 flex-1 overflow-y-auto px-2 py-1";

type SectionKey = keyof typeof OPEN_SECTIONS;


const PANE_PATH_CHARS = 34;
export function CollabPane() {
  const { t } = useTranslation(["collab", "workspace"]);
  const live = useCollabLiveStore(
    useShallow((state) => ({
      projectId: state.projectId,
      share: state.share,
      members: state.members,
    })),
  );
  const entries = useCollabActivity((state) => state.entries);
  const unread = useCollabActivity((state) => state.unread);
  const showTree = useSettingsStore((state) => state.showTree);
  const filesProjectId = useFilesStore((state) => state.projectId);
  const [sectionOpen, setSectionOpen] = useSectionOpen(filesProjectId);
  const accessLogShown = useAccessLogShown();
  const manage = t(($) => $.collab.pane.manage);
  const peopleTitle = t(($) => $.collab.pane.people);
  const activityTitle = t(($) => $.collab.pane.activity);
  const deletedTitle = t(($) => $.collab.pane.deleted);
  const accessLogTitle = t(($) => $.collab.pane.accessLog);
  const projectId = live.projectId;
  const selfId = live.share?.account_id ?? null;
  const resizeLabel = useCallback(
    (first: string, second: string) => t(($) => $.workspace.explorer.resizeSections, { first, second }),
    [t],
  );

  useEffect(() => {
    if (showTree && unread) useCollabActivity.getState().markRead();
  }, [showTree, unread]);

  const openFor = (key: SectionKey) => sectionOpen[key] ?? OPEN_SECTIONS[key];
  const setOpen = (key: SectionKey, open: boolean) =>
    setSectionOpen((value) => ((value[key] ?? OPEN_SECTIONS[key]) === open ? value : { ...value, [key]: open }));
  const section = (key: SectionKey, id: string, title: string, handleId: string, body: (open: boolean, toggle: (open: boolean) => void) => ReactNode): StackSection => ({
    id,
    title,
    handleId,
    collapsed: !openFor(key),
    onCollapsedChange: (collapsed) => setOpen(key, !collapsed),
    render: (collapsed, toggle) => body(!collapsed, (open) => toggle(!open)),
  });

  const sections: StackSection[] = [];
  if (live.members.length > 0) {
    sections.push(
      section("people", "collab-people-v", peopleTitle, "collab-people-resize", (open, onOpenChange) => (
        <SidebarSection
          id="collab-people"
          title={peopleTitle}
          icon={<Users aria-hidden className="size-3.5" />}
          count={live.members.length}
          open={open}
          onOpenChange={onOpenChange}
          className={open ? SECTION_OPEN : SECTION_SHUT}
          contentClassName={SECTION_SCROLL}
        >
          <People title={peopleTitle} members={live.members} selfId={selfId} />
        </SidebarSection>
      )),
    );
  }
  sections.push(
    section("activity", "collab-activity-v", activityTitle, "collab-activity-resize", (open, onOpenChange) => (
      <SidebarSection
        id="collab-activity"
        title={activityTitle}
        icon={<Activity aria-hidden className="size-3.5" />}
        count={entries.length}
        open={open}
        onOpenChange={onOpenChange}
        className={open ? SECTION_OPEN : SECTION_SHUT}
        contentClassName={SECTION_SCROLL}
      >
        <ActivityList title={activityTitle} entries={entries} />
      </SidebarSection>
    )),
    section("deleted", "collab-deleted-v", deletedTitle, "collab-deleted-resize", (open, onOpenChange) => (
      <RecentlyDeleted open={open} onOpenChange={onOpenChange} />
    )),
  );
  if (accessLogShown) {
    sections.push(
      section("accessLog", "collab-access-log-v", accessLogTitle, "collab-access-log-resize", (open, onOpenChange) => (
        <AccessLog open={open} onOpenChange={onOpenChange} />
      )),
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="collab-pane">
      <SidebarPanelHeader icon={RadioTower} title={t(($) => $.collab.pane.title)}>
        <span className="flex shrink-0 items-center gap-0.5">
          <SyncStatus />
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
        </span>
      </SidebarPanelHeader>
      <div className="min-h-0 flex-1">
        <SidebarSectionStack
          groupId={COLLAB_GROUP_ID}
          persist={false}
          fillerId="collab-filler-v"
          fillerHandleId="collab-filler-resize"
          sections={sections}
          resizeLabel={resizeLabel}
          testId="collab-stack"
        />
      </div>
    </div>
  );
}
