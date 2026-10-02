import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, X } from "lucide-react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import { ModalShell } from "@/components/ui/modal-shell";
import { LeafLogo } from "@/components/layout/LeafLogo";
import { loadReleaseNotesRenderer, openableReleaseLink } from "@/components/layout/ReleaseNotes";
import { ReleaseTimeline, VersionTag, type ReleaseHistoryView } from "@/components/layout/ReleaseTimeline";
import {
  compareVersions,
  tauriReleasePageFetcher,
  useReleaseHistory,
  type ReleaseEntry,
} from "@/lib/release-history";
import { appVersion } from "@/lib/tauri";
import { openUpdateWindow } from "@/lib/updater";

export function ChangelogView({
  titleId,
  installedVersion,
  history,
  onOpenLink,
  onUpdate,
  onClose,
  now,
}: Readonly<{
  titleId?: string;
  installedVersion: string;
  history: ReleaseHistoryView;
  onOpenLink: (url: string) => void;
  onUpdate: () => void;
  onClose: () => void;
  now?: () => number;
}>) {
  const { t, i18n } = useTranslation(["common", "shell"]);
  const locale = i18n.resolvedLanguage ?? "en";
  const scrollRef = useRef<HTMLDivElement>(null);
  const newest = history.entries[0]?.version;
  const behind = Boolean(installedVersion && newest && compareVersions(installedVersion, newest) < 0);
  const expandRelease = useCallback(
    (entry: ReleaseEntry, index: number) =>
      index === 0 || Boolean(installedVersion && compareVersions(entry.version, installedVersion) > 0),
    [installedVersion],
  );

  return (
    <div
      data-testid="changelog"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground"
    >
      <header className="flex shrink-0 items-start gap-3 border-b px-4 py-3">
        <LeafLogo className="pointer-events-none mt-px size-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-sm font-semibold text-foreground">
            {t(($) => $.shell.settings.help.resources.whatsNew)}
          </h2>
          {installedVersion && (
            <p
              data-testid="changelog-status"
              className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground"
            >
              <span>{t(($) => $.shell.updateWindow.currentVersion, { version: installedVersion })}</span>
              {newest && <span aria-hidden="true">·</span>}
              {newest && !behind && <span>{t(($) => $.shell.updateWindow.upToDate)}</span>}
              {newest && behind && (
                <>
                  <span>{t(($) => $.shell.updateWindow.available)}</span>
                  <VersionTag version={newest} emphasis />
                </>
              )}
            </p>
          )}
        </div>
        {behind && (
          <Button size="sm" onClick={onUpdate} className="shrink-0">
            <Download aria-hidden="true" className="size-3.5" />
            {t(($) => $.shell.updateChecker.updateNow)}
          </Button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={t(($) => $.common.actions.close)}
          className="-mr-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground"
        >
          <X className="size-4" />
        </button>
      </header>
      <div ref={scrollRef} data-testid="changelog-scroll" className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4">
        <ReleaseTimeline
          scrollRef={scrollRef}
          history={history}
          installedVersion={installedVersion || undefined}
          expandRelease={expandRelease}
          locale={locale}
          now={now}
          onOpenLink={onOpenLink}
        />
      </div>
    </div>
  );
}

export function ChangelogDialog({ open, onClose }: Readonly<{ open: boolean; onClose: () => void }>) {
  const { t } = useTranslation(["common"]);
  const titleId = useId();
  const [version, setVersion] = useState("");
  const history = useReleaseHistory({ fetchPage: tauriReleasePageFetcher, enabled: open });

  useEffect(() => {
    if (!open) return;
    let active = true;
    loadReleaseNotesRenderer().catch(() => undefined);
    void appVersion()
      .then((value) => {
        if (active) setVersion(value);
      })
      .catch(() => {
        if (active) setVersion("");
      });
    return () => {
      active = false;
    };
  }, [open]);

  const openLink = useCallback((url: string) => {
    const safe = openableReleaseLink(url);
    if (safe) void openExternal(safe);
  }, []);

  if (!open) return null;

  return (
    <ModalShell
      open
      onClose={onClose}
      closeLabel={t(($) => $.common.actions.close)}
      layer="nested"
      as="dialog"
      surface={false}
      labelledBy={titleId}
      className="m-0 h-[min(80vh,720px)] w-full max-w-2xl border-0 bg-transparent p-0 text-foreground shadow-2xl"
    >
      <ChangelogView
        titleId={titleId}
        installedVersion={version}
        history={{
          entries: history.entries,
          status: history.status,
          onLoadMore: history.loadMore,
          onRetry: history.retry,
        }}
        onOpenLink={openLink}
        onUpdate={() => void openUpdateWindow({ manual: true })}
        onClose={onClose}
      />
    </ModalShell>
  );
}
