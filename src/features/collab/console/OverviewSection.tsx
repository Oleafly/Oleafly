import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { TriangleAlert, UserRoundPlus } from "lucide-react";
import { SettingsNote } from "@/components/settings/SettingsNote";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckBadge } from "@/components/ui/check-badge";
import { LoadingState } from "@/components/ui/empty";
import { SectionHeading } from "@/components/ui/section-heading";
import { StatCard } from "@/components/ui/stat-card";
import { formatBytes } from "@/lib/format-bytes";
import { formatDateTime, formatList, formatNumber, formatRelativeTimeFrom } from "@/lib/intl";
import type { CollabAdminOverview, CollabHealthIssue, CollabMember } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { collabErrorMessage } from "../errors";
import { LoadFailed } from "../feedback";
import { RUNTIME_SETTING_COPY, RUNTIME_SETTING_FIELDS } from "../RuntimeSettingsTab";
import { OverviewActivity } from "./OverviewActivity";
import type { ConsoleSection } from "./sections";
import type { OverviewState } from "./use-admin-overview";

const ISSUE_KEYS = {
  no_sign_in_provider: "noSignInProvider",
  storage_not_writable: "storageNotWritable",
  sign_in_failing: "signInFailing",
  sign_in_emails_paused: "signInEmailsPaused",
  comments_changed_while_off: "commentsChangedWhileOff",
  unknown: "unknown",
} as const satisfies Record<CollabHealthIssue, string>;

const MEGABYTE = 1024 * 1024;
const COMMENT_CHANGES_SHOWN = 20;
// Card columns by how many cards there are, so a full row never leaves a gap.
const CARD_COLUMNS: Record<number, string> = {
  4: "grid-cols-2 @3xl:grid-cols-4",
  5: "grid-cols-2 @lg:grid-cols-3 @3xl:grid-cols-5",
};

function Block({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-2">
      <SectionHeading id={id}>{title}</SectionHeading>
      {children}
    </section>
  );
}

type Card = Readonly<{ id: string; label: string; value: string; detail?: string }>;

function Health({
  overview,
  members,
}: Readonly<{ overview: CollabAdminOverview; members: readonly CollabMember[] | null }>) {
  const { t } = useTranslation(["collab"]);
  const issues = overview.health.issues;
  if (issues.length === 0) {
    return (
      <SettingsRow
        icon={<CheckBadge tone="success" className="mt-0.5" />}
        label={t(($) => $.collab.console.overview.health.okLabel)}
        description={t(($) => $.collab.console.overview.health.okDescription)}
      />
    );
  }
  const providerName = (id: string) => overview.providers.find((provider) => provider.id === id)?.label || id;
  return (
    <div className="space-y-2">
      {issues.map((issue) => {
        const key = ISSUE_KEYS[issue] ?? "unknown";
        return (
          <div key={issue} className="space-y-1">
            <SettingsRow
              icon={<TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />}
              label={t(($) => $.collab.console.overview.health.issues[key].label)}
              description={t(($) => $.collab.console.overview.health.issues[key].description)}
            />
            {issue === "sign_in_failing" ? <SignInProblems overview={overview} name={providerName} /> : null}
            {issue === "comments_changed_while_off" ? <CommentChanges overview={overview} members={members} /> : null}
          </div>
        );
      })}
    </div>
  );
}

// Which sign-in option fails, since when, and the provider's own words.
function SignInProblems({
  overview,
  name,
}: Readonly<{ overview: CollabAdminOverview; name: (provider: string) => string }>) {
  const { t } = useTranslation(["collab"]);
  const problems = overview.sign_in_problems ?? [];
  if (problems.length === 0) return null;
  return (
    <ul className="ml-6 space-y-1 text-xs" data-testid="console-sign-in-problems">
      {problems.map((problem) => (
        <li key={`${problem.provider}-${problem.at}`} className="space-y-0.5">
          <p className="font-medium">
            {t(($) => $.collab.console.overview.health.problem, {
              provider: name(problem.provider),
              time: formatDateTime(problem.at),
            })}
          </p>
          {problem.reason ? <p className="select-text break-words text-muted-foreground">{problem.reason}</p> : null}
        </li>
      ))}
    </ul>
  );
}

// Where comments changed while they were off, by whom and when. The server
// stored those changes before it could check them.
function CommentChanges({
  overview,
  members,
}: Readonly<{ overview: CollabAdminOverview; members: readonly CollabMember[] | null }>) {
  const { t } = useTranslation(["collab"]);
  const changes = (overview.comments_changed_while_off ?? []).slice(0, COMMENT_CHANGES_SHOWN);
  if (changes.length === 0) return null;
  const nameOf = (accountId: string | null | undefined) =>
    accountId ? members?.find((member) => member.account.account_id === accountId)?.account.display_name : undefined;
  return (
    <ul className="ml-6 space-y-1 text-xs" data-testid="console-comment-changes">
      {changes.map((change) => {
        const project = change.project_title || change.project_id;
        const name = nameOf(change.account_id);
        const time = formatDateTime(change.at);
        return (
          <li key={`${change.project_id}-${change.at}-${change.account_id ?? ""}`} className="select-text break-words">
            {name
              ? t(($) => $.collab.console.overview.health.commentChange, { project, name, time })
              : t(($) => $.collab.console.overview.health.commentChangeUnknown, { project, time })}
          </li>
        );
      })}
    </ul>
  );
}

// Nobody is told by email when an invitation waits for approval, so the
// overview names the count and leads to the list.
function PendingGuests({
  count,
  onNavigate,
}: Readonly<{ count: number; onNavigate: (section: ConsoleSection) => void }>) {
  const { t } = useTranslation(["collab"]);
  if (count <= 0) return null;
  return (
    <SettingsRow
      testId="console-pending-guests"
      icon={<UserRoundPlus aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />}
      label={t(($) => $.collab.console.overview.glance.pendingGuests, { number: formatNumber(count) })}
      control={
        <Button type="button" variant="outline" size="sm" onClick={() => onNavigate("people")}>
          {t(($) => $.collab.console.overview.glance.reviewGuests)}
        </Button>
      }
    />
  );
}

function Glance({ overview }: Readonly<{ overview: CollabAdminOverview }>) {
  const { t } = useTranslation(["collab"]);
  const { counts, storage } = overview;
  const cards: Card[] = [
    {
      id: "people",
      label: t(($) => $.collab.console.overview.glance.people),
      value: formatNumber(counts.people),
      detail:
        counts.suspended_people > 0
          ? t(($) => $.collab.console.overview.glance.suspended, { number: formatNumber(counts.suspended_people) })
          : undefined,
    },
    {
      id: "devices",
      label: t(($) => $.collab.console.overview.glance.devices),
      value: formatNumber(counts.devices),
    },
    {
      id: "projects",
      label: t(($) => $.collab.console.overview.glance.projects),
      value: formatNumber(counts.projects),
      detail: t(($) => $.collab.console.overview.glance.projectsDetail, {
        archived: formatNumber(counts.archived_projects),
        pending: formatNumber(counts.pending_projects),
      }),
    },
    {
      id: "online",
      label: t(($) => $.collab.console.overview.glance.online),
      value: formatNumber(counts.people_online),
      detail: t(($) => $.collab.console.overview.glance.onlineDetail, { number: formatNumber(counts.open_rooms) }),
    },
  ];
  if (storage) {
    cards.push({
      id: "storage",
      label: t(($) => $.collab.console.overview.storage.title),
      value: formatBytes(storage.database_bytes + storage.snapshot_bytes + storage.file_bytes),
      detail: t(($) => $.collab.console.overview.storage.location[storage.files_location]),
    });
  }
  return (
    <div className="space-y-3">
      <dl className={cn("grid gap-3", CARD_COLUMNS[cards.length])}>
        {cards.map((card) => (
          <StatCard key={card.id} id={card.id} label={card.label} value={card.value} detail={card.detail} />
        ))}
      </dl>
      <ServerFacts overview={overview} />
    </div>
  );
}

// When the server started and which version it runs, as one quiet line.
function ServerFacts({ overview }: Readonly<{ overview: CollabAdminOverview }>) {
  const { t } = useTranslation(["collab"]);
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
      <div data-stat="started" className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
        <dt className="text-muted-foreground">{t(($) => $.collab.console.overview.glance.started)}</dt>
        <dd className="font-medium">{formatRelativeTimeFrom(overview.started_at, overview.now)}</dd>
        <dd className="text-muted-foreground">{formatDateTime(overview.started_at)}</dd>
      </div>
      <div data-stat="version" className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
        <dt className="text-muted-foreground">{t(($) => $.collab.console.overview.glance.version)}</dt>
        <dd className="font-medium">{overview.version}</dd>
        <dd className="text-muted-foreground">
          {t(($) => $.collab.console.overview.glance.protocol, { protocol: String(overview.protocol.max) })}
        </dd>
      </div>
    </dl>
  );
}

// Shades of one colour, darkest first, in the order of the bar.
const STORAGE_TONES = ["bg-primary", "bg-primary/65", "bg-primary/35"] as const;

function Storage({ overview }: Readonly<{ overview: CollabAdminOverview }>) {
  const { t } = useTranslation(["collab"]);
  const storage = overview.storage;
  if (!storage) return <SettingsNote>{t(($) => $.collab.console.overview.storage.adminOnly)}</SettingsNote>;
  const parts = [
    {
      id: "database",
      label: t(($) => $.collab.console.overview.storage.database),
      bytes: storage.database_bytes,
      detail: t(($) => $.collab.console.overview.storage.databaseDetail),
    },
    {
      id: "snapshots",
      label: t(($) => $.collab.console.overview.storage.snapshots),
      bytes: storage.snapshot_bytes,
      detail: t(($) => $.collab.console.overview.storage.snapshotsDetail),
    },
    {
      id: "files",
      label: t(($) => $.collab.console.overview.storage.files),
      bytes: storage.file_bytes,
      detail: t(($) => $.collab.console.overview.storage.location[storage.files_location]),
    },
  ].map((part, index) => ({ ...part, tone: STORAGE_TONES[index] }));
  const total = parts.reduce((sum, part) => sum + Math.max(0, part.bytes), 0);
  return (
    <div className="rounded-lg border bg-card p-4" data-testid="console-storage">
      <div
        aria-hidden
        data-testid="console-storage-bar"
        className={cn("flex h-2.5 gap-0.5 overflow-hidden rounded-full", total === 0 && "bg-muted")}
      >
        {total > 0
          ? parts
              .filter((part) => part.bytes > 0)
              .map((part) => (
                <span
                  key={part.id}
                  data-part={part.id}
                  className={cn("h-full min-w-1", part.tone)}
                  style={{ flexGrow: part.bytes / total, flexBasis: 0 }}
                />
              ))
          : null}
      </div>
      <dl className="mt-4 grid gap-3 @lg:grid-cols-3">
        {parts.map((part) => (
          <div key={part.id} data-stat={part.id} className="min-w-0">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span aria-hidden className={cn("size-2.5 shrink-0 rounded-[2px]", part.tone)} />
              {part.label}
            </dt>
            <dd className="mt-1 text-base font-semibold tabular-nums">{formatBytes(part.bytes)}</dd>
            <dd className="mt-0.5 text-[0.6875rem] text-muted-foreground">{part.detail}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Services({
  overview,
  onNavigate,
}: Readonly<{ overview: CollabAdminOverview; onNavigate: (section: ConsoleSection) => void }>) {
  const { t } = useTranslation(["collab"]);
  const providers = overview.providers.map((provider) =>
    provider.kind === "email_link" ? t(($) => $.collab.console.overview.services.emailLinkOption) : provider.label,
  );
  return (
    <div className="space-y-2">
      <EmailStatusRow
        configured={overview.email_configured}
        control={
          <Button type="button" variant="outline" size="sm" onClick={() => onNavigate("email")}>
            {t(($) => $.collab.console.overview.services.openEmail)}
          </Button>
        }
      />
      <SettingsRow
        label={t(($) => $.collab.console.overview.services.signIn)}
        description={
          providers.length > 0 ? formatList(providers) : t(($) => $.collab.console.overview.services.signInNone)
        }
      />
    </div>
  );
}

function EmailStatusRow({ configured, control }: Readonly<{ configured: boolean; control?: ReactNode }>) {
  const { t } = useTranslation(["collab"]);
  return (
    <SettingsRow
      testId="console-email-status"
      label={t(($) => $.collab.console.overview.services.email)}
      adornment={
        configured ? (
          <Badge variant="success" size="sm">
            {t(($) => $.collab.console.overview.services.emailOn)}
          </Badge>
        ) : (
          <Badge variant="muted" size="sm">
            {t(($) => $.collab.console.overview.services.emailOff)}
          </Badge>
        )
      }
      description={
        configured
          ? t(($) => $.collab.console.overview.services.emailOnDescription)
          : t(($) => $.collab.console.overview.services.emailOffDescription)
      }
      control={control}
    />
  );
}

function SettingsGlance({
  overview,
  onNavigate,
}: Readonly<{ overview: CollabAdminOverview; onNavigate: (section: ConsoleSection) => void }>) {
  const { t } = useTranslation(["collab"]);
  const limits = overview.limits;
  return (
    <div className="space-y-2">
      {RUNTIME_SETTING_FIELDS.map((field) => {
        const key = RUNTIME_SETTING_COPY[field];
        const on = overview.settings[field];
        return (
          <SettingsRow
            key={field}
            testId={`console-setting-${field}`}
            label={t(($) => $.collab.admin.settings[key].label)}
            control={
              <Badge variant={on ? "success" : "muted"} size="sm">
                {on ? t(($) => $.collab.console.overview.settings.on) : t(($) => $.collab.console.overview.settings.off)}
              </Badge>
            }
          />
        );
      })}
      <SettingsNote>
        {t(($) => $.collab.console.overview.limits, {
          project: formatBytes(limits.max_project_mb * MEGABYTE),
          file: formatBytes(limits.max_file_mb * MEGABYTE),
          people: formatNumber(limits.max_members_per_project),
        })}
      </SettingsNote>
      <Button type="button" variant="outline" size="sm" onClick={() => onNavigate("settings")}>
        {t(($) => $.collab.console.overview.settings.change)}
      </Button>
    </div>
  );
}

export function OverviewSection({
  state,
  members = null,
  onNavigate,
  onRetry,
}: Readonly<{
  state: OverviewState;
  // The server's people, to name who made a change, once they are loaded.
  members?: readonly CollabMember[] | null;
  onNavigate: (section: ConsoleSection) => void;
  onRetry: () => void;
}>) {
  const { t } = useTranslation(["collab"]);
  if (state.status === "loading") {
    return <LoadingState size="compact" label={t(($) => $.collab.console.overview.loading)} />;
  }
  if (state.status === "failed") {
    return (
      <LoadFailed
        message={t(($) => $.collab.admin.loadFailed)}
        reason={collabErrorMessage(state.code)}
        onRetry={onRetry}
      />
    );
  }
  const overview = state.overview;
  return (
    <div className="@container space-y-6" data-testid="console-overview">
      <Block title={t(($) => $.collab.console.overview.health.title)}>
        <Health overview={overview} members={members} />
      </Block>
      <Block title={t(($) => $.collab.console.overview.glance.title)}>
        <PendingGuests count={overview.counts.pending_guest_approvals ?? 0} onNavigate={onNavigate} />
        <Glance overview={overview} />
      </Block>
      {overview.activity ? (
        <Block title={t(($) => $.collab.console.overview.activity.title)}>
          <OverviewActivity activity={overview.activity} />
        </Block>
      ) : null}
      <Block title={t(($) => $.collab.console.overview.storage.title)}>
        <Storage overview={overview} />
      </Block>
      <Block title={t(($) => $.collab.console.overview.services.title)}>
        <Services overview={overview} onNavigate={onNavigate} />
      </Block>
      <Block title={t(($) => $.collab.console.overview.settings.title)}>
        <SettingsGlance overview={overview} onNavigate={onNavigate} />
      </Block>
    </div>
  );
}
