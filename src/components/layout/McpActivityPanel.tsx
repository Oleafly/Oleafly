import { useEffect, useMemo } from "react";
import { Activity, CheckCircle2, CircleAlert, Loader2, Radio, Trash2 } from "lucide-react";
import {
  formatMcpArgs,
  useMcpActivityStore,
  type McpLogEntry,
} from "@/store/mcp-activity";
import { useSettingsStore } from "@/store/settings";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function timeLabel(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

function StatusIcon({ status }: { status: McpLogEntry["status"] }) {
  if (status === "running") {
    return <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden />;
  }
  if (status === "error") {
    return <CircleAlert className="size-3.5 shrink-0 text-destructive" aria-hidden />;
  }
  return <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />;
}

function LogRow({ entry }: { entry: McpLogEntry }) {
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
              {timeLabel(entry.ts)}
              {entry.durationMs != null ? ` · ${entry.durationMs}ms` : ""}
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

/** Live log of MCP tools/call traffic — only mounted while the MCP rail tab is open. */
export function McpActivityPanel() {
  const logs = useMcpActivityStore((s) => s.logs);
  const serverRunning = useMcpActivityStore((s) => s.serverRunning);
  const clearLogs = useMcpActivityStore((s) => s.clearLogs);
  const clearUnread = useMcpActivityStore((s) => s.clearUnread);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const setSettingsInitialSection = useSettingsStore((s) => s.setSettingsInitialSection);

  useEffect(() => {
    clearUnread();
  }, [clearUnread]);

  return (
    <div className="flex h-full flex-col" data-testid="mcp-activity-panel">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-sidebar-border px-3">
        <Activity className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-medium uppercase tracking-wide text-sidebar-foreground/70">
          MCP activity
        </span>
        <span
          className={cn(
            "ml-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
            serverRunning
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
              : "bg-muted text-muted-foreground",
          )}
        >
          <Radio className={cn("size-2.5", serverRunning && "animate-pulse")} />
          {serverRunning ? "Live" : "Off"}
        </span>
        <div className="ml-auto">
          <Tooltip label="Clear log">
            <button
              type="button"
              aria-label="Clear MCP log"
              disabled={logs.length === 0}
              onClick={clearLogs}
              className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
            >
              <Trash2 className="size-3.5" />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-1.5">
        {logs.length === 0 ? (
          <div className="px-2 py-8 text-center text-xs text-muted-foreground">
            {serverRunning ? (
              <>
                <p>Waiting for external agents…</p>
                <p className="mt-1.5 text-[11px]">
                  Tools called over MCP (Claude, Cursor, Grok, …) show up here live.
                </p>
              </>
            ) : (
              <>
                <p>MCP server is off.</p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={() => {
                    setSettingsInitialSection("mcp");
                    setSettingsOpen(true);
                  }}
                >
                  Open MCP settings
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
