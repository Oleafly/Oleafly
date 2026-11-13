import { useCloudBackupsOn } from "@/components/cloud/use-cloud-backup-schedule";
import { CloudRestoreDialog } from "@/components/settings/cloud/CloudRestoreDialog";
import { SettingsRow } from "@/components/settings/SettingsRow";
import { SettingsToggleRow } from "@/components/settings/SettingsToggleRow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/empty";
import { SectionHeading } from "@/components/ui/section-heading";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useNow } from "@/hooks/use-now";
import { describeError } from "@/lib/app-error";
import { BACKUP_EVERY_HOURS, BACKUP_KEEP, type CloudBackupSummary } from "@/lib/cloud-backups";
import { formatBytes } from "@/lib/format-bytes";
import { formatDateTime, formatRelativeTimeFrom } from "@/lib/intl";
import { useCloudProviderName } from "@/store/cloud";
import { useCloudBackupStore } from "@/store/cloud-backups";
import { History } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

function useContents(): (counts: { notes: number; projects: number }) => string {
  const { t } = useTranslation(["cloud"]);
  return ({ notes, projects }) => {
    const parts = [t(($) => $.cloud.backups.notes, { count: notes })];
    if (projects > 0) parts.push(t(($) => $.cloud.backups.projects, { count: projects }));
    return parts.join(" · ");
  };
}

function Summary() {
  const { t } = useTranslation(["cloud"]);
  const state = useCloudBackupStore((s) => s.state);
  const running = useCloudBackupStore((s) => s.running || s.state?.running === true);
  const runError = useCloudBackupStore((s) => s.runError);
  const contents = useContents();
  const now = useNow();
  if (!state) return null;
  const problem = runError ?? state.lastError;
  return (
    <>
      <span className="block truncate" data-testid="cloud-backups-summary">
        {state.lastOkMs && state.last
          ? t(($) => $.cloud.backups.last, {
              time: formatRelativeTimeFrom(state.lastOkMs, now),
              contents: contents(state.last),
              size: formatBytes(state.last.bytes),
            })
          : t(($) => $.cloud.backups.none)}
      </span>
      {running ? (
        <span className="flex items-center gap-1.5" data-testid="cloud-backups-running">
          <Spinner size="xs" />
          {t(($) => $.cloud.backups.running)}
        </span>
      ) : null}
      {!running && problem ? (
        <span role="alert" className="block text-destructive" data-testid="cloud-backups-error">
          {t(($) => $.cloud.backups.failed, { reason: describeError(problem) })}
        </span>
      ) : null}
    </>
  );
}

function ChoiceRow({
  testId,
  label,
  description,
  value,
  options,
  optionLabel,
  onChange,
}: Readonly<{
  testId: string;
  label: string;
  description: string;
  value: number;
  options: readonly number[];
  optionLabel: (option: number) => string;
  onChange: (value: number) => void;
}>) {
  return (
    <SettingsRow
      testId={testId}
      label={label}
      description={description}
      control={
        <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
          <SelectTrigger className="w-[208px]" aria-label={label} data-testid={`${testId}-trigger`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="z-[100]">
            {options.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {optionLabel(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );
}

function BackupRow({
  backup,
  onRestore,
}: Readonly<{ backup: CloudBackupSummary; onRestore: (backup: CloudBackupSummary) => void }>) {
  const { t } = useTranslation(["cloud"]);
  const contents = useContents();
  const date = formatDateTime(backup.createdMs);
  return (
    <li className="flex items-center gap-3 px-3 py-2" data-testid="cloud-backup-row">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-foreground">
          {date}
          {backup.scheduled ? null : (
            <Badge variant="muted" size="sm">
              {t(($) => $.cloud.backups.row.manual)}
            </Badge>
          )}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {[
            backup.thisDevice ? t(($) => $.cloud.backups.row.thisComputer) : backup.deviceName,
            contents(backup),
            formatBytes(backup.bytes),
          ].join(" · ")}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={t(($) => $.cloud.backups.row.restoreLabel, { date })}
        onClick={() => onRestore(backup)}
      >
        {t(($) => $.cloud.backups.row.restore)}
      </Button>
    </li>
  );
}

function BackupList({ provider }: Readonly<{ provider: string }>) {
  const { t } = useTranslation(["cloud"]);
  const backups = useCloudBackupStore((s) => s.backups);
  const listing = useCloudBackupStore((s) => s.listing);
  const listError = useCloudBackupStore((s) => s.listError);
  const loadBackups = useCloudBackupStore((s) => s.loadBackups);
  const [restoring, setRestoring] = useState<CloudBackupSummary | null>(null);

  useEffect(() => {
    if (useCloudBackupStore.getState().backups === null) void loadBackups();
  }, [loadBackups]);

  let body: ReactNode;
  if (listError && !backups) {
    body = (
      <ErrorState size="compact" message={t(($) => $.cloud.backups.list.failed, { reason: describeError(listError) })}>
        <Button type="button" size="sm" variant="outline" onClick={() => void loadBackups()}>
          {t(($) => $.cloud.tryAgain)}
        </Button>
      </ErrorState>
    );
  } else if (!backups) {
    body = <LoadingState size="compact" label={t(($) => $.cloud.backups.list.loading)} />;
  } else if (backups.length === 0) {
    body = (
      <EmptyState size="compact" icon={<History aria-hidden />} title={t(($) => $.cloud.backups.list.empty, { provider })} />
    );
  } else {
    body = (
      <ul
        aria-label={t(($) => $.cloud.backups.list.label)}
        aria-busy={listing || undefined}
        className="max-h-80 divide-y overflow-y-auto rounded-md border bg-background"
      >
        {backups.map((backup) => (
          <BackupRow key={`${backup.device}/${backup.id}`} backup={backup} onRestore={setRestoring} />
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-2">
      <SectionHeading>{t(($) => $.cloud.backups.list.title, { provider })}</SectionHeading>
      {body}
      <CloudRestoreDialog backup={restoring} onClose={() => setRestoring(null)} />
    </div>
  );
}

export function CloudBackupsCard() {
  return useCloudBackupsOn() ? <BackupsCard /> : null;
}

function BackupsCard() {
  const { t } = useTranslation(["cloud"]);
  const provider = useCloudProviderName();
  const state = useCloudBackupStore((s) => s.state);
  const running = useCloudBackupStore((s) => s.running || s.state?.running === true);
  const load = useCloudBackupStore((s) => s.load);
  const update = useCloudBackupStore((s) => s.update);
  const runNow = useCloudBackupStore((s) => s.runNow);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  if (!state) return null;
  const { settings } = state;
  return (
    <CollapsibleSection
      id="cloud-backups"
      title={t(($) => $.cloud.backups.title)}
      description={<Summary />}
      open={open}
      onOpenChange={setOpen}
      trailing={
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={running}
          data-testid="cloud-backup-now"
          onClick={() => void runNow(false)}
        >
          {running ? <Spinner /> : null}
          {t(($) => $.cloud.backups.backUpNow)}
        </Button>
      }
    >
      <div className="space-y-2" data-testid="cloud-backups-body">
        <SettingsToggleRow
          testId="cloud-backups-auto"
          label={t(($) => $.cloud.backups.auto.label)}
          description={t(($) => $.cloud.backups.auto.description, { provider })}
          checked={settings.auto}
          onChange={(auto) => void update({ auto })}
        />
        <ChoiceRow
          testId="cloud-backups-every"
          label={t(($) => $.cloud.backups.every.label)}
          description={t(($) => $.cloud.backups.every.description)}
          value={settings.everyHours}
          options={BACKUP_EVERY_HOURS}
          optionLabel={(hours) => t(($) => $.cloud.backups.every.options[String(hours) as "6" | "24" | "168"])}
          onChange={(everyHours) => void update({ everyHours })}
        />
        <ChoiceRow
          testId="cloud-backups-keep"
          label={t(($) => $.cloud.backups.keep.label)}
          description={t(($) => $.cloud.backups.keep.description, { provider })}
          value={settings.keep}
          options={BACKUP_KEEP}
          optionLabel={(count) => t(($) => $.cloud.backups.keep.option, { count })}
          onChange={(keep) => void update({ keep })}
        />
        <SettingsToggleRow
          testId="cloud-backups-projects"
          label={t(($) => $.cloud.backups.includeProjects.label)}
          description={t(($) => $.cloud.backups.includeProjects.description)}
          checked={settings.includeProjects}
          onChange={(includeProjects) => void update({ includeProjects })}
        />
        {open ? <BackupList provider={provider} /> : null}
      </div>
    </CollapsibleSection>
  );
}
