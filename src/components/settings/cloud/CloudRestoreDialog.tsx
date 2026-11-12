import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/empty";
import { ModalShell } from "@/components/ui/modal-shell";
import { SearchField } from "@/components/ui/search-field";
import { Spinner } from "@/components/ui/spinner";
import { describeError } from "@/lib/app-error";
import { type CloudBackupEntry, type CloudBackupSummary, cloudBackupEntries, cloudBackupRestore } from "@/lib/cloud-backups";
import { formatBytes } from "@/lib/format-bytes";
import { formatDate, formatDateTime } from "@/lib/intl";
import { logError } from "@/lib/log";
import { useFilesStore } from "@/store/files";
import { FolderOpen, NotebookPen } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type Outcome = { kind: "restored"; copy: boolean } | { kind: "failed"; error: string };

function EntryRow({
  entry,
  outcome,
  busy,
  onRestore,
}: Readonly<{ entry: CloudBackupEntry; outcome: Outcome | undefined; busy: boolean; onRestore: (entry: CloudBackupEntry) => void }>) {
  const { t } = useTranslation(["cloud"]);
  const Icon = entry.kind === "note" ? NotebookPen : FolderOpen;
  let badge = (
    <Badge variant={entry.here ? "muted" : "info"} size="sm">
      {entry.here ? t(($) => $.cloud.backups.restore.here) : t(($) => $.cloud.backups.restore.missing)}
    </Badge>
  );
  if (outcome?.kind === "restored") {
    badge = (
      <Badge variant="success" size="sm">
        {outcome.copy ? t(($) => $.cloud.backups.restore.restoredCopy) : t(($) => $.cloud.backups.restore.restored)}
      </Badge>
    );
  }
  return (
    <li className="flex items-center gap-3 px-3 py-2" data-testid="cloud-restore-row">
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-foreground">
          <span className="truncate">{entry.name}</span>
          {badge}
        </p>
        <p className="text-xs text-muted-foreground">
          {t(($) => $.cloud.backups.restore.files, { count: entry.files })} · {formatBytes(entry.bytes)}
        </p>
        {outcome?.kind === "failed" ? (
          <p role="alert" className="text-xs text-destructive">
            {describeError(outcome.error)}
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy || outcome?.kind === "restored"}
        aria-label={t(($) => $.cloud.backups.restore.oneLabel, { name: entry.name })}
        onClick={() => onRestore(entry)}
      >
        {t(($) => $.cloud.backups.restore.one)}
      </Button>
    </li>
  );
}

export function CloudRestoreDialog({
  backup,
  onClose,
}: Readonly<{ backup: CloudBackupSummary | null; onClose: () => void }>) {
  const { t } = useTranslation(["common", "cloud"]);
  const titleId = useId();
  const descriptionId = useId();
  const [entries, setEntries] = useState<readonly CloudBackupEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, Outcome>>(new Map());

  const load = useCallback(() => {
    if (!backup) return;
    setError(null);
    cloudBackupEntries(backup.device, backup.id).then(setEntries, (error_: unknown) => setError(String(error_)));
  }, [backup]);

  useEffect(() => {
    setEntries(null);
    setQuery("");
    setOutcomes(new Map());
    load();
  }, [load]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (entries ?? []).filter((entry) => !needle || entry.name.toLowerCase().includes(needle));
  }, [entries, query]);
  const missing = (entries ?? []).filter((entry) => !entry.here && outcomes.get(entry.id)?.kind !== "restored");

  const restore = async (ids: string[] | null) => {
    if (!backup || busy) return;
    setBusy(true);
    const label = t(($) => $.cloud.backups.restore.copyName, { date: formatDate(backup.createdMs, { dateStyle: "medium" }) });
    try {
      const result = await cloudBackupRestore(backup.device, backup.id, ids, label);
      setOutcomes((current) => {
        const next = new Map(current);
        for (const done of result.restored) next.set(done.from, { kind: "restored", copy: done.copy });
        for (const failure of result.failed) next.set(failure.id, { kind: "failed", error: failure.error });
        return next;
      });
      if (result.restored.length > 0) {
        await useFilesStore.getState().refreshProjects().catch((error_: unknown) => logError("refresh the library after a restore", error_));
      }
    } catch (error_) {
      setError(String(error_));
    } finally {
      setBusy(false);
    }
  };

  if (!backup) return null;
  const date = formatDateTime(backup.createdMs);

  let body: ReactNode;
  if (error && !entries) {
    body = (
      <ErrorState size="compact" message={t(($) => $.cloud.backups.restore.loadFailed, { reason: describeError(error) })}>
        <Button type="button" size="sm" variant="outline" onClick={load}>
          {t(($) => $.cloud.tryAgain)}
        </Button>
      </ErrorState>
    );
  } else if (!entries) {
    body = <LoadingState size="compact" label={t(($) => $.cloud.backups.restore.loading)} />;
  } else if (shown.length === 0) {
    body = <EmptyState size="compact" title={t(($) => $.cloud.backups.restore.noMatch)} />;
  } else {
    body = (
      <ul
        aria-label={t(($) => $.cloud.backups.restore.listLabel)}
        className="max-h-[45vh] divide-y overflow-y-auto rounded-md border bg-background"
      >
        {shown.map((entry) => (
          <EntryRow
            key={entry.id}
            entry={entry}
            outcome={outcomes.get(entry.id)}
            busy={busy}
            onRestore={(chosen) => void restore([chosen.id])}
          />
        ))}
      </ul>
    );
  }

  return (
    <ModalShell
      open
      onClose={onClose}
      closeLabel={t(($) => $.common.actions.close)}
      layer="raised"
      width="lg"
      labelledBy={titleId}
      describedBy={descriptionId}
      className="space-y-3 p-5"
      testId="cloud-restore-dialog"
    >
      <div>
        <h2 id={titleId} className="text-sm font-semibold">
          {t(($) => $.cloud.backups.restore.title, { date })}
        </h2>
        <p id={descriptionId} className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t(($) => $.cloud.backups.restore.description)}
        </p>
      </div>
      {entries && entries.length > 8 ? (
        <SearchField
          value={query}
          onChange={setQuery}
          label={t(($) => $.cloud.backups.restore.search)}
          placeholder={t(($) => $.cloud.backups.restore.search)}
          clearLabel={t(($) => $.cloud.backups.restore.clearSearch)}
        />
      ) : null}
      {body}
      {error && entries ? (
        <p role="alert" className="text-xs text-destructive">
          {describeError(error)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose} data-modal-initial-focus>
          {t(($) => $.common.actions.close)}
        </Button>
        {entries ? (
          <Button
            type="button"
            size="sm"
            disabled={busy || missing.length === 0}
            data-testid="cloud-restore-missing"
            onClick={() => void restore(null)}
          >
            {busy ? <Spinner /> : null}
            {missing.length > 0
              ? t(($) => $.cloud.backups.restore.allMissing, { count: missing.length })
              : t(($) => $.cloud.backups.restore.nothingMissing)}
          </Button>
        ) : null}
      </div>
    </ModalShell>
  );
}
