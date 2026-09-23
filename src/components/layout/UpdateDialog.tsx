import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, Download, ExternalLink, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { LeafLogo } from "@/components/layout/LeafLogo";
import { PRIMARY_TEXT, ReleaseNotes } from "@/components/layout/ReleaseNotes";
import {
  parseReleaseDate,
  RelativeTime,
  ReleaseTimeline,
  splitNotesTitle,
  VersionTagButton,
  type ReleaseHistoryView,
} from "@/components/layout/ReleaseTimeline";
import { cn } from "@/lib/utils";

export type UpdateHistoryView = ReleaseHistoryView;

export type UpdatePhase = "checking" | "available" | "upToDate" | "downloading" | "error";

export interface UpdateDialogProps {
  phase: UpdatePhase;
  nextVersion?: string;
  currentVersion?: string;
  releaseDate?: string;
  notes?: string;
  percent: number;
  errorMessage: string;
  selfInstallable: boolean;
  installedVersion: string;
  onClose: () => void;
  onInstall: () => void;
  onRetry: () => void;
  onOpenRelease: () => void;
  onOpenLink: (url: string) => void;
  history?: UpdateHistoryView;
  now?: () => number;
}

export function UpdateDialog({
  phase,
  nextVersion,
  currentVersion,
  releaseDate,
  notes,
  percent,
  errorMessage,
  selfInstallable,
  installedVersion,
  onClose,
  onInstall,
  onRetry,
  onOpenRelease,
  onOpenLink,
  history,
  now = Date.now,
}: Readonly<UpdateDialogProps>) {
  const { t, i18n } = useTranslation(["common", "shell"]);
  const locale = i18n.resolvedLanguage ?? "en";
  const hasUpdate = Boolean(nextVersion);
  const showsTimeline = hasUpdate && (phase === "available" || phase === "downloading" || phase === "error");
  const { body: notesBody } = splitNotesTitle(notes);
  const scrollRef = useRef<HTMLDivElement>(null);

  const heading = (() => {
    if (phase === "checking") return t(($) => $.shell.updateWindow.checking);
    if (phase === "upToDate") return t(($) => $.shell.updateWindow.upToDate);
    if (hasUpdate) return t(($) => $.shell.updateWindow.available);
    return t(($) => $.shell.updateChecker.checkFailed);
  })();

  const subtitle = (() => {
    if (phase === "upToDate") {
      return installedVersion
        ? t(($) => $.shell.updateWindow.upToDateVersion, { version: installedVersion })
        : t(($) => $.shell.updateWindow.upToDateGeneric);
    }
    if (!hasUpdate) return null;
    return (
      <>
        {currentVersion && <span>{t(($) => $.shell.updateWindow.currentVersion, { version: currentVersion })}</span>}
        {currentVersion && parseReleaseDate(releaseDate) && <span aria-hidden="true">·</span>}
        <RelativeTime
          value={releaseDate}
          locale={locale}
          now={now}
          render={(when) => t(($) => $.shell.updateWindow.released, { when })}
        />
      </>
    );
  })();

  const renderFooter = () => {
    if (phase === "downloading") {
      const installing = percent >= 100;
      return (
        <div className="space-y-2" aria-live="polite">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
              <Loader2 aria-hidden="true" className="size-3.5 motion-safe:animate-spin" />
              {installing
                ? t(($) => $.shell.updateChecker.installing)
                : t(($) => $.shell.updateChecker.downloading, { percent })}
            </span>
            <span className="text-[11px] text-muted-foreground">{t(($) => $.shell.updateChecker.restartNotice)}</span>
          </div>
          <Progress value={percent} indicatorClassName="bg-primary" />
        </div>
      );
    }
    if (phase === "available") {
      return (
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-[11px] leading-snug text-muted-foreground">
            {selfInstallable
              ? t(($) => $.shell.updateChecker.restartNotice)
              : t(($) => $.shell.updateWindow.packageInstall)}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t(($) => $.shell.updateWindow.later)}
            </Button>
            {selfInstallable ? (
              <Button size="sm" onClick={onInstall}>
                <Download aria-hidden="true" className="size-3.5" />
                {t(($) => $.shell.updateChecker.updateNow)}
              </Button>
            ) : (
              <Button size="sm" onClick={onOpenRelease}>
                <ExternalLink aria-hidden="true" className="size-3.5" />
                {t(($) => $.shell.updateChecker.downloadFromGithub)}
              </Button>
            )}
          </div>
        </div>
      );
    }
    if (phase === "error") {
      return (
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t(($) => $.common.actions.close)}
          </Button>
          <Button variant="secondary" size="sm" onClick={onOpenRelease}>
            <ExternalLink aria-hidden="true" className="size-3.5" />
            {t(($) => $.shell.updateChecker.downloadFromGithub)}
          </Button>
          <Button size="sm" onClick={onRetry}>
            <RotateCcw aria-hidden="true" className="size-3.5" />
            {t(($) => $.shell.updateChecker.tryAgain)}
          </Button>
        </div>
      );
    }
    if (phase === "upToDate") {
      return (
        <div className="flex items-center justify-end">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t(($) => $.common.actions.close)}
          </Button>
        </div>
      );
    }
    return null;
  };

  const errorBlock = phase === "error" && (
    <div role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
      <p className="flex items-start gap-2 text-xs text-foreground">
        <AlertTriangle aria-hidden="true" className="mt-px size-3.5 shrink-0 text-destructive" />
        {t(($) => $.shell.updateWindow.error)}
      </p>
      {errorMessage && (
        <pre
          data-testid="update-error-details"
          className="mt-2 max-h-20 select-text overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground"
        >
          {errorMessage}
        </pre>
      )}
    </div>
  );

  const footer = renderFooter();

  return (
    <div
      data-testid="update-dialog"
      data-phase={phase}
      className="flex h-screen flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground"
    >
      <header data-tauri-drag-region className="flex shrink-0 items-start gap-3 border-b px-4 py-3">
        <LeafLogo className="pointer-events-none mt-px size-5 shrink-0" />
        <div data-tauri-drag-region className="min-w-0 flex-1">
          <div data-tauri-drag-region className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-sm font-semibold text-foreground">{heading}</h1>
            {hasUpdate && phase !== "upToDate" && nextVersion && (
              <VersionTagButton
                version={nextVersion}
                label={t(($) => $.shell.updateWindow.viewRelease)}
                onOpen={onOpenRelease}
              />
            )}
          </div>
          {subtitle && (
            <p
              data-tauri-drag-region
              className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground"
            >
              {subtitle}
            </p>
          )}
        </div>
        {phase !== "downloading" && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t(($) => $.common.actions.close)}
            className="-mr-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </header>

      <div
        ref={scrollRef}
        data-testid="update-notes-scroll"
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4"
      >
        {showsTimeline && nextVersion ? (
          <>
            {errorBlock}
            <ReleaseTimeline
              scrollRef={scrollRef}
              history={history}
              lead={{
                version: nextVersion,
                content: notesBody ? (
                  <ReleaseNotes source={notesBody} onOpenLink={onOpenLink} />
                ) : (
                  <p className="text-[13px] text-muted-foreground">{t(($) => $.shell.updateWindow.ready)}</p>
                ),
              }}
              endLabel={currentVersion ? t(($) => $.shell.updateWindow.currentVersion, { version: currentVersion }) : null}
              locale={locale}
              now={now}
              onOpenLink={onOpenLink}
            />
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            {phase === "checking" && (
              <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />
                {t(($) => $.shell.updateWindow.looking)}
              </p>
            )}
            {phase === "upToDate" && (
              <CheckCircle2 aria-hidden="true" className={cn("size-12", PRIMARY_TEXT)} strokeWidth={1.5} />
            )}
            {phase === "error" && <div className="w-full max-w-md text-left">{errorBlock}</div>}
          </div>
        )}
      </div>

      {footer && <footer className="shrink-0 border-t px-4 py-3">{footer}</footer>}
    </div>
  );
}
