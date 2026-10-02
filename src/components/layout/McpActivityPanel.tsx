import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Activity, CheckCircle2, CircleAlert, Info, Radio, Trash2 } from "lucide-react";
import {
  formatMcpArgs,
  useMcpActivityStore,
  type McpLogEntry,
} from "@/store/mcp-activity";
import { useSettingsStore } from "@/store/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { AiToolsGrid } from "@/components/ai/AiToolsList";
import { formatTime } from "@/lib/intl";
import { cn } from "@/lib/utils";
import { SidebarPanelHeader } from "@/components/layout/SidebarSection";
import { Spinner } from "@/components/ui/spinner";

function timeLabel(ts: number): string {
  try {
    return formatTime(ts, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

function StatusIcon({ status }: Readonly<{ status: McpLogEntry["status"] }>) {
  if (status === "running") {
    return <Spinner size="sm" className="text-primary" />;
  }
  if (status === "error") {
    return <CircleAlert className="size-3.5 shrink-0 text-destructive" aria-hidden />;
  }
  return <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />;
}

function LogRow({ entry }: Readonly<{ entry: McpLogEntry }>) {
  const { t } = useTranslation(["shell"]);
  const args = useMemo(() => formatMcpArgs(entry.args), [entry.args]);
  return (
    <li
      data-testid="mcp-log-entry"
      className={cn(
        "rounded-md border border-transparent px-2 py-1.5",
        entry.status === "running" && "border-primary/20 bg-primary/5",
        entry.status === "error" && "border-destructive/20 bg-destructive/5",
      )}
    >
      <div className="flex items-start gap-1.5">
        <StatusIcon status={entry.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate font-mono text-xs font-medium text-foreground">{entry.name}</span>
            <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
              {entry.durationMs != null
                ? t(($) => $.shell.mcpActivity.timeWithDuration, {
                    time: timeLabel(entry.ts),
                    ms: entry.durationMs,
                  })
                : timeLabel(entry.ts)}
            </span>
          </div>
          {args && (
            <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground" title={args}>
              {args}
            </p>
          )}
          {entry.summary && (
            <p
              className={cn(
                "mt-0.5 line-clamp-2 font-mono text-[10px]",
                entry.status === "error" ? "text-destructive" : "text-muted-foreground",
              )}
              title={entry.summary}
            >
              {entry.summary}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

// Only mounted while the MCP rail tab is open.
export function McpActivityPanel() {
  const { t } = useTranslation(["shell"]);
  const logs = useMcpActivityStore((s) => s.logs);
  const serverRunning = useMcpActivityStore((s) => s.serverRunning);
  const clearLogs = useMcpActivityStore((s) => s.clearLogs);
  const clearUnread = useMcpActivityStore((s) => s.clearUnread);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const setSettingsInitialSection = useSettingsStore((s) => s.setSettingsInitialSection);
  const setSettingsScrollTarget = useSettingsStore((s) => s.setSettingsScrollTarget);

  useEffect(() => {
    clearUnread();
  }, [clearUnread]);

  return (
    <div className="flex h-full flex-col" data-testid="mcp-activity-panel">
      <SidebarPanelHeader
        icon={Activity}
        title={t(($) => $.shell.rail.mcp)}
        adornment={
          <Badge variant={serverRunning ? "success" : "muted"} size="sm" className="gap-1">
            <Radio className={cn("size-2.5", serverRunning && "animate-pulse")} />
            {serverRunning
              ? t(($) => $.shell.mcpActivity.live)
              : t(($) => $.shell.mcpActivity.off)}
          </Badge>
        }
      >
        <Tooltip
          side="bottom"
          wide
          label={
            <div>
              <p className="mb-1.5 font-medium text-foreground">
                {t(($) => $.shell.mcpActivity.toolsTitle)}
              </p>
              <AiToolsGrid columns={1} />
            </div>
          }
        >
          <button
            type="button"
            aria-label={t(($) => $.shell.mcpActivity.toolsTitle)}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Info className="size-3.5" />
          </button>
        </Tooltip>
        <Tooltip label={t(($) => $.shell.mcpActivity.clearLog)}>
          <button
            type="button"
            aria-label={t(($) => $.shell.mcpActivity.clearLogAriaLabel)}
            disabled={logs.length === 0}
            onClick={clearLogs}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <Trash2 className="size-3.5" />
          </button>
        </Tooltip>
      </SidebarPanelHeader>

      <div className="min-h-0 flex-1 overflow-auto p-1.5">
        {logs.length === 0 ? (
          <div className="px-2 py-8 text-center text-xs text-muted-foreground">
            {serverRunning ? (
              <>
                <p>{t(($) => $.shell.mcpActivity.waiting)}</p>
                <p className="mt-1.5 text-[11px]">
                  {t(($) => $.shell.mcpActivity.waitingHint)}
                </p>
              </>
            ) : (
              <>
                <p>{t(($) => $.shell.mcpActivity.serverOff)}</p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={() => {
                    setSettingsInitialSection("integrations");
                    setSettingsScrollTarget("oleafly-mcp");
                    setSettingsOpen(true);
                  }}
                >
                  {t(($) => $.shell.mcpActivity.openSettings)}
                </Button>
              </>
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {logs.map((e) => (
              <LogRow key={e.id} entry={e} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
