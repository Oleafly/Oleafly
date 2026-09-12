import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Update } from "@tauri-apps/plugin-updater";
import { isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import { AlertTriangle, ArrowUpCircle, CheckCircle2, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { installUpdate, runUpdateCheck } from "@/lib/updater";
import { logError } from "@/lib/log";
import { useUpdatesStore } from "@/store/updates";
import { Progress } from "@/components/ui/progress";
import { formatRelativeTime } from "@/lib/intl";
import { cn } from "@/lib/utils";

const RELEASES_URL = "https://github.com/Oleafly/Oleafly/releases";

function relativeTime(t: number): string {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return formatRelativeTime(-s, "second");
  const m = Math.floor(s / 60);
  if (m < 60) return formatRelativeTime(-m, "minute");
  const h = Math.floor(m / 60);
  if (h < 24) return formatRelativeTime(-h, "hour");
  return formatRelativeTime(-Math.floor(h / 24), "day");
}

type State =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; percent: number }
  | { kind: "error" };

export function UpdateChecker({ className }: { className?: string }) {
  const { t } = useTranslation(["shell"]);
  // Snapshot once: in the browser dev server there is no updater at all, so we
  // render an "unsupported" note instead of a misleading "up to date".
  const [supported] = useState(isTauri);
  const [state, setState] = useState<State>({ kind: "idle" });
  // Surfaces a silent startup-check failure (recorded by runUpdateCheck).
  const lastCheckFailed = useUpdatesStore((s) => s.lastCheckFailed);
  const lastCheckAt = useUpdatesStore((s) => s.lastCheckAt);

  const releaseNotes = () => void open(RELEASES_URL);

  const check = async () => {
    setState({ kind: "checking" });
    try {
      const update = await runUpdateCheck({ rethrow: true });
      setState(update ? { kind: "available", update } : { kind: "upToDate" });
    } catch {
      // runUpdateCheck already logged the error and flagged the store.
      setState({ kind: "error" });
    }
  };

  const install = async (update: Update) => {
    setState({ kind: "downloading", percent: 0 });
    try {
      await installUpdate(update, (percent) => setState({ kind: "downloading", percent }));
      // installUpdate relaunches on success; this line is unreachable in the app.
    } catch (e) {
      await logError("updater", e);
      setState({ kind: "error" });
    }
  };

  if (!supported) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        {t(($) => $.shell.updateChecker.unsupported)}
      </p>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {(state.kind === "idle" || state.kind === "checking") && (
        <div className="flex flex-col items-center gap-1.5">
          {state.kind === "idle" && lastCheckFailed && (
            <p className="inline-flex items-center gap-1.5 text-xs text-destructive">
              <AlertTriangle className="size-3.5" />
              {lastCheckAt
                ? t(($) => $.shell.updateChecker.lastCheckFailedAt, {
                    when: relativeTime(lastCheckAt),
                  })
                : t(($) => $.shell.updateChecker.lastCheckFailed)}
            </p>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={check}
            disabled={state.kind === "checking"}
          >
            <RefreshCw className={cn("size-3.5", state.kind === "checking" && "animate-spin")} />
            {state.kind === "checking"
              ? t(($) => $.shell.updateChecker.checking)
              : t(($) => $.shell.updateChecker.check)}
          </Button>
        </div>
      )}

      {state.kind === "upToDate" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-4" />
            {t(($) => $.shell.updateChecker.latest)}
          </span>
          <button
            type="button"
            onClick={releaseNotes}
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            {t(($) => $.shell.updateChecker.releaseNotes)}
            <ExternalLink className="size-3" />
          </button>
          <button
            type="button"
            onClick={check}
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="size-3" />
            {t(($) => $.shell.updateChecker.checkAgain)}
          </button>
        </div>
      )}

      {state.kind === "available" && (
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <ArrowUpCircle className="size-4 text-primary" />
            {t(($) => $.shell.updateChecker.available, { version: state.update.version })}
          </div>
          {state.update.body?.trim() && (
            <Markdown className="mt-2 max-h-48 overflow-auto rounded bg-background/60 p-2.5 text-xs text-muted-foreground [scrollbar-width:thin]">
              {state.update.body.trim()}
            </Markdown>
          )}
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={() => install(state.update)}>
              {t(($) => $.shell.updateChecker.updateNow)}
            </Button>
            <button
              type="button"
              onClick={releaseNotes}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {t(($) => $.shell.updateChecker.releaseNotes)}
              <ExternalLink className="size-3" />
            </button>
          </div>
        </div>
      )}

      {state.kind === "downloading" && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            {state.percent >= 100
              ? t(($) => $.shell.updateChecker.installing)
              : t(($) => $.shell.updateChecker.downloading, { percent: state.percent })}
          </p>
          <Progress value={state.percent} />
          <p className="text-[10px] text-muted-foreground">
            {t(($) => $.shell.updateChecker.restartNotice)}
          </p>
        </div>
      )}

      {state.kind === "error" && (
        <div className="space-y-2">
          <p className="inline-flex items-center gap-1.5 text-xs text-destructive">
            <AlertTriangle className="size-4" />
            {t(($) => $.shell.updateChecker.checkFailed)}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={check}>
              <RefreshCw className="size-3.5" />
              {t(($) => $.shell.updateChecker.tryAgain)}
            </Button>
            <button
              type="button"
              onClick={releaseNotes}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {t(($) => $.shell.updateChecker.downloadFromGithub)}
              <ExternalLink className="size-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
