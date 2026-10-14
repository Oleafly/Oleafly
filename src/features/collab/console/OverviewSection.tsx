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
import { StatGrid, type Stat } from "@/components/ui/stat-grid";
import { formatBytes } from "@/lib/format-bytes";
import { formatDateTime, formatList, formatNumber, formatRelativeTimeFrom } from "@/lib/intl";
import type { CollabAdminOverview, CollabHealthIssue } from "@/lib/tauri";
import { collabErrorMessage } from "../errors";
import { LoadFailed } from "../feedback";
import { RUNTIME_SETTING_COPY, RUNTIME_SETTING_FIELDS } from "../RuntimeSettingsTab";
import type { ConsoleSection } from "./sections";
import type { OverviewState } from "./use-admin-overview";

const ISSUE_KEYS = {
  no_sign_in_provider: "noSignInProvider",
  storage_not_writable: "storageNotWritable",
  unknown: "unknown",
} as const satisfies Record<CollabHealthIssue, string>;

const MEGABYTE = 1024 * 1024;

function Block({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-2">
      <SectionHeading id={id}>{title}</SectionHeading>
      {children}
    </section>
  );
}

function Figures({ stats }: Readonly<{ stats: readonly Stat[] }>) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <StatGrid className="border-t-0 sm:grid-cols-3" stats={stats} />
    </div>
  );
}

function Health({ overview }: Readonly<{ overview: CollabAdminOverview }>) {
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
  return (
    <div className="space-y-2">
      {issues.map((issue) => {
        const key = ISSUE_KEYS[issue] ?? "unknown";
        return (
          <SettingsRow
            key={issue}
            icon={<TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />}
            label={t(($) => $.collab.console.overview.health.issues[key].label)}
            description={t(($) => $.collab.console.overview.health.issues[key].description)}
          />
        );
      })}
    </div>
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
  const counts = overview.counts;
  const stats: Stat[] = [
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
    {
      id: "started",
      label: t(($) => $.collab.console.overview.glance.started),
      value: formatRelativeTimeFrom(overview.started_at, overview.now),
      detail: formatDateTime(overview.started_at),
    },
    {
      id: "version",
      label: t(($) => $.collab.console.overview.glance.version),
      value: overview.version,
      detail: t(($) => $.collab.console.overview.glance.protocol, { protocol: String(overview.protocol.max) }),
    },
  ];
  return <Figures stats={stats} />;
}

function Storage({ overview }: Readonly<{ overview: CollabAdminOverview }>) {
  const { t } = useTranslation(["collab"]);
  const storage = overview.storage;
  if (!storage) return <SettingsNote>{t(($) => $.collab.console.overview.storage.adminOnly)}</SettingsNote>;
  return (
    <Figures
      stats={[
        {
          id: "database",
          label: t(($) => $.collab.console.overview.storage.database),
          value: formatBytes(storage.database_bytes),
          detail: t(($) => $.collab.console.overview.storage.databaseDetail),
        },
        {
          id: "snapshots",
          label: t(($) => $.collab.console.overview.storage.snapshots),
          value: formatBytes(storage.snapshot_bytes),
          detail: t(($) => $.collab.console.overview.storage.snapshotsDetail),
        },
        {
          id: "files",
          label: t(($) => $.collab.console.overview.storage.files),
          value: formatBytes(storage.file_bytes),
          detail: t(($) => $.collab.console.overview.storage.location[storage.files_location]),
        },
      ]}
    />
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
  onNavigate,
  onRetry,
}: Readonly<{
  state: OverviewState;
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
    <div className="space-y-6" data-testid="console-overview">
      <Block title={t(($) => $.collab.console.overview.health.title)}>
        <Health overview={overview} />
      </Block>
      <Block title={t(($) => $.collab.console.overview.glance.title)}>
        <PendingGuests count={overview.counts.pending_guest_approvals ?? 0} onNavigate={onNavigate} />
        <Glance overview={overview} />
      </Block>
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
