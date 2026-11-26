import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/ui/empty";
import { ModalShell } from "@/components/ui/modal-shell";
import { IntegrationError } from "@/components/settings/IntegrationCard";
import { OverleafBrandIcon } from "@/components/settings/IntegrationBrandIcons";
import { formatRelativeTimeFrom } from "@/lib/intl";
import { logError } from "@/lib/log";
import { overleafSignIns, type OverleafSavedSignIn } from "@/lib/overleaf";
import { serverHost } from "@/lib/overleaf-live";
import { useOverleafImportStore } from "@/store/overleaf-import";

const DATE_AFTER_DAYS = 7;

function keyOf(row: OverleafSavedSignIn): string {
  return `${row.server} ${row.userId}`;
}

function detailsOf(row: OverleafSavedSignIn): string {
  const host = serverHost(row.server);
  if (row.signedInAt === null) return host;
  return `${host} · ${formatRelativeTimeFrom(row.signedInAt * 1000, Date.now(), { dateAfterDays: DATE_AFTER_DAYS })}`;
}

function useSignIns(open: boolean) {
  const asking = useOverleafImportStore((state) => state.unsent !== null);
  const [rows, setRows] = useState<OverleafSavedSignIn[] | null>(null);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);

  const reload = useCallback(async () => {
    const asked = ++request.current;
    try {
      const found = await overleafSignIns();
      if (request.current !== asked) return;
      setRows(found);
      setFailed(false);
    } catch (error) {
      void logError("list Overleaf sign-ins", error);
      if (request.current === asked) setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (open && !asking) void reload();
    return () => {
      request.current += 1;
    };
  }, [open, asking, reload]);

  return { rows, failed, reload };
}

export interface ManageSignInsDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  addLabel: string;
  onAdd(): void;
  onSwitched?(): void;
}

export function ManageSignInsDialog({ open, onOpenChange, addLabel, onAdd, onSwitched }: Readonly<ManageSignInsDialogProps>) {
  const { t } = useTranslation(["common", "settings"]);
  const server = useOverleafImportStore((state) => state.server);
  const signOut = useOverleafImportStore((state) => state.signOut);
  const switchAccount = useOverleafImportStore((state) => state.switchAccount);
  const importing = useOverleafImportStore((state) => state.importing);
  const titleId = useId();
  const descriptionId = useId();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);
  const { rows, failed, reload } = useSignIns(open);
  const close = () => onOpenChange(false);
  const listed = rows ?? [];

  const work = async (run: () => Promise<boolean>) => {
    setBusy(true);
    setRefused(false);
    const done = await run();
    setRefused(!done);
    setBusy(false);
    await reload();
    return done;
  };

  const removeAll = async () => {
    for (const row of listed) {
      if (!(await signOut(false, row.userId, row.server))) return false;
      if (useOverleafImportStore.getState().unsent !== null) return true;
    }
    return true;
  };

  const switchTo = async (row: OverleafSavedSignIn) => {
    if (!(await work(() => switchAccount(row.server, row.userId)))) return;
    close();
    onSwitched?.();
  };

  return (
    <ModalShell
      open={open}
      onClose={close}
      closeLabel={t(($) => $.common.actions.close)}
      layer="nested"
      width="lg"
      labelledBy={titleId}
      describedBy={descriptionId}
      className="space-y-4 p-5"
      testId="manage-sign-ins"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 id={titleId} className="text-base font-semibold">
            {t(($) => $.settings.integrations.signIns.title)}
          </h2>
          <p id={descriptionId} className="text-xs text-muted-foreground">
            {t(($) => $.settings.integrations.signIns.description)}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={t(($) => $.common.actions.close)}
          onClick={close}
        >
          <X aria-hidden className="size-4" />
        </Button>
      </div>

      {rows === null && !failed ? (
        <LoadingState label={t(($) => $.settings.integrations.signIns.loading)} className="justify-center py-6" />
      ) : null}
      {rows?.length === 0 ? (
        <EmptyState title={t(($) => $.settings.integrations.signIns.empty)} className="py-6" />
      ) : null}
      {listed.length > 0 ? (
        <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-lg border bg-card">
          {listed.map((row) => (
            <SignInRow
              key={keyOf(row)}
              row={row}
              inUse={row.current && row.server === server}
              disabled={busy || importing}
              onSwitch={() => void switchTo(row)}
              onRemove={() => void work(() => signOut(false, row.userId, row.server))}
            />
          ))}
        </ul>
      ) : null}
      {failed || refused ? (
        <IntegrationError>
          {failed
            ? t(($) => $.settings.integrations.signIns.loadFailed)
            : t(($) => $.settings.integrations.signIns.changeFailed)}
        </IntegrationError>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {listed.length > 1 ? (
          <Button
            type="button"
            variant="link"
            className="mr-auto px-0"
            disabled={busy || importing}
            onClick={() => void work(removeAll)}
          >
            {t(($) => $.settings.integrations.signIns.removeAll)}
          </Button>
        ) : null}
        <Button type="button" variant="secondary" disabled={busy || importing} onClick={onAdd}>
          {addLabel}
        </Button>
        <Button type="button" data-modal-initial-focus onClick={close}>
          {t(($) => $.common.actions.done)}
        </Button>
      </div>
    </ModalShell>
  );
}

function SignInRow({
  row,
  inUse,
  disabled,
  onSwitch,
  onRemove,
}: Readonly<{
  row: OverleafSavedSignIn;
  inUse: boolean;
  disabled: boolean;
  onSwitch(): void;
  onRemove(): void;
}>) {
  const { t } = useTranslation(["common", "settings"]);
  const account = row.email ?? row.userId;
  return (
    <li data-testid="saved-sign-in" className="flex items-center gap-3 px-3 py-2">
      <OverleafBrandIcon className="size-5 shrink-0 text-[#47A141]" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{account}</p>
        <p className="truncate text-xs text-muted-foreground">{detailsOf(row)}</p>
      </div>
      {inUse ? (
        <Badge variant="muted">{t(($) => $.settings.integrations.signIns.inUse)}</Badge>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={t(($) => $.settings.integrations.signIns.switchTo, { account })}
          onClick={onSwitch}
        >
          {t(($) => $.settings.integrations.signIns.switch)}
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        aria-label={t(($) => $.settings.integrations.signIns.removeAccount, { account })}
        onClick={onRemove}
      >
        {t(($) => $.common.actions.remove)}
      </Button>
    </li>
  );
}
