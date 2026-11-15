import { Fragment, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Copy, Download, FolderOpen, Lock, Logs, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { EmptyState, LoadingState } from "@/components/ui/empty";
import { Highlighted } from "@/components/ui/highlighted";
import { SearchField } from "@/components/ui/search-field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { useCopyStatus } from "@/components/ui/use-copy-status";
import { formatDate, formatNumber, formatTime } from "@/lib/intl";
import { logError } from "@/lib/log";
import { pickSavePath } from "@/lib/native-file-dialog";
import { basename } from "@/lib/path-utils";
import {
  clearLogs,
  exportLogArchive,
  readLogEntries,
  revealAppLog,
  type LogEntry,
  type LogLevel,
} from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type LevelFilter = "all" | "warning" | "error";

type Field = readonly [string, string];

interface LogRow {
  key: string;
  entry: LogEntry;
  fields: Field[];
  privateFields: Field[];
  haystack: string;
}

interface LogGroup {
  key: string;
  label: string;
  rows: LogRow[];
}

type LoadState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; entries: LogEntry[] };

const LEVEL_FILTERS: readonly LevelFilter[] = ["all", "warning", "error"];

const LEVEL_BADGE: Record<LogLevel, "muted" | "warning" | "destructive"> = {
  info: "muted",
  warning: "warning",
  error: "destructive",
};

const ROW_GRID = "grid grid-cols-[6rem_4.5rem_minmax(0,1fr)_0.875rem] items-center gap-x-3 px-3";

const DAY_MS = 86_400_000;

function fieldsOf(value: unknown): Field[] {
  if (value === null || value === undefined) return [];
  if (typeof value !== "object" || Array.isArray(value)) return [["value", stringValue(value)]];
  return Object.entries(value).map(([key, item]) => [key, stringValue(item)] as const);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function matchRanges(text: string, query: string): [number, number][] {
  if (!query) return [];
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  let at = lower.indexOf(query);
  while (at !== -1) {
    ranges.push([at, at + query.length]);
    at = lower.indexOf(query, at + query.length);
  }
  return ranges;
}

function fieldText(fields: readonly Field[]): string {
  return fields.map(([key, value]) => `${key}=${value}`).join("  ");
}

function entryText(entry: LogEntry): string {
  const lines = [`${new Date(entry.ts_ms).toISOString()} ${entry.level} ${entry.message}`];
  for (const [key, value] of [...fieldsOf(entry.safe), ...fieldsOf(entry.sensitive)]) {
    lines.push(`${key}=${value}`);
  }
  return lines.join("\n");
}

function toRows(entries: readonly LogEntry[]): LogRow[] {
  return entries
    .map((entry, index) => {
      const fields = fieldsOf(entry.safe);
      const privateFields = fieldsOf(entry.sensitive);
      return {
        key: `${entry.ts_ms}-${index}`,
        entry,
        fields,
        privateFields,
        haystack: `${entry.message} ${fieldText(fields)} ${fieldText(privateFields)}`.toLowerCase(),
      };
    })
    .reverse();
}

function dayStart(value: number): number {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function exportFileName(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `oleafly-logs-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.zip`;
}

function FieldList({ fields }: Readonly<{ fields: readonly Field[] }>) {
  return (
    <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-4 gap-y-1 font-mono text-[0.6875rem] leading-4">
      {fields.map(([key, value]) => (
        <Fragment key={key}>
          <dt className="truncate text-muted-foreground">{key}</dt>
          <dd className="break-all text-foreground">{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function LogDetails({ row }: Readonly<{ row: LogRow }>) {
  const { t } = useTranslation(["settings"]);
  const { copied, copy } = useCopyStatus();
  return (
    <div className={cn(ROW_GRID, "pb-3.5 pt-0.5")}>
      <div className="col-start-3 col-end-5 space-y-3">
        <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">{row.entry.message}</p>
        {row.fields.length > 0 ? <FieldList fields={row.fields} /> : null}
        {row.privateFields.length > 0 ? (
          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
              <Lock aria-hidden className="size-3" />
              {t(($) => $.settings.logs.privateDetails)}
            </p>
            <FieldList fields={row.privateFields} />
          </div>
        ) : null}
        <Button type="button" variant="outline" size="xs" onClick={() => void copy(entryText(row.entry))}>
          <Copy aria-hidden />
          {copied ? t(($) => $.settings.logs.copied) : t(($) => $.settings.logs.copyEntry)}
        </Button>
      </div>
    </div>
  );
}

function LogRowView({
  row,
  query,
  open,
  onToggle,
}: Readonly<{ row: LogRow; query: string; open: boolean; onToggle: (key: string) => void }>) {
  const { t } = useTranslation(["settings"]);
  const { entry } = row;
  return (
    <div className={cn("border-b border-border/50 last:border-b-0", open && "bg-accent/50")}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onToggle(row.key)}
        className={cn(ROW_GRID, "w-full py-2 text-left text-xs transition-colors hover:bg-accent/40 focus-visible:bg-accent/40")}
      >
        <span className="whitespace-nowrap font-mono text-[0.6875rem] text-muted-foreground">
          {formatTime(entry.ts_ms, { timeStyle: "medium" })}
        </span>
        <span className="flex">
          <Badge variant={LEVEL_BADGE[entry.level]} size="sm">
            {t(($) => $.settings.logs.level[entry.level])}
          </Badge>
        </span>
        <span className="min-w-0 truncate">
          <Highlighted text={entry.message} ranges={matchRanges(entry.message, query)} />
          {row.fields.length > 0 ? (
            <span className="ml-2.5 font-mono text-[0.6875rem] text-muted-foreground">{fieldText(row.fields)}</span>
          ) : null}
        </span>
        <ChevronRight
          aria-hidden
          className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")}
        />
      </button>
      {open ? <LogDetails row={row} /> : null}
    </div>
  );
}

export function LogsSection() {
  const { t } = useTranslation(["settings", "common"]);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<LevelFilter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const loading = state.status === "loading";

  useEffect(() => {
    if (!loading) return;
    let active = true;
    readLogEntries()
      .then((entries) => {
        if (active) setState({ status: "ready", entries });
      })
      .catch((error) => {
        void logError("read log entries", error);
        if (active) setState({ status: "failed" });
      });
    return () => {
      active = false;
    };
  }, [loading]);

  const entries = state.status === "ready" ? state.entries : [];
  const rows = useMemo(() => toRows(entries), [entries]);
  const needle = query.trim().toLowerCase();
  const searched = useMemo(
    () => (needle ? rows.filter((row) => row.haystack.includes(needle)) : rows),
    [rows, needle],
  );
  const counts: Record<LevelFilter, number> = {
    all: searched.length,
    warning: searched.filter((row) => row.entry.level === "warning").length,
    error: searched.filter((row) => row.entry.level === "error").length,
  };
  const visible = level === "all" ? searched : searched.filter((row) => row.entry.level === level);

  const groups = useMemo(() => {
    const today = dayStart(Date.now());
    const label = (start: number) => {
      if (start === today) return t(($) => $.settings.logs.groups.today);
      if (start === dayStart(today - DAY_MS / 2)) return t(($) => $.settings.logs.groups.yesterday);
      return formatDate(start, { weekday: "short", month: "short", day: "numeric" });
    };
    const byDay: LogGroup[] = [];
    for (const row of visible) {
      const start = dayStart(row.entry.ts_ms);
      const last = byDay.at(-1);
      if (last?.key === String(start)) last.rows.push(row);
      else byDay.push({ key: String(start), label: label(start), rows: [row] });
    }
    return byDay;
  }, [visible, t]);

  const total = entries.length;
  const hasEntries = total > 0;

  const exportLogs = async () => {
    try {
      const destination = await pickSavePath({
        defaultPath: exportFileName(new Date()),
        filters: [{ name: t(($) => $.settings.logs.dialog.filterName), extensions: ["zip"] }],
      });
      if (!destination) return;
      await exportLogArchive(destination);
      toast.success(t(($) => $.settings.logs.toast.exported, { name: basename(destination) || destination }));
    } catch (error) {
      void logError("export logs", error);
      toast.error(t(($) => $.settings.logs.toast.exportFailed));
    }
  };

  const openFolder = async () => {
    try {
      await revealAppLog();
    } catch (error) {
      void logError("reveal app log", error);
      toast.error(t(($) => $.settings.logs.toast.revealFailed));
    }
  };

  const clearAll = async () => {
    setConfirmClear(false);
    try {
      await clearLogs();
      setExpanded(null);
      setState({ status: "ready", entries: [] });
    } catch (error) {
      void logError("clear logs", error);
      toast.error(t(($) => $.settings.logs.toast.clearFailed));
    }
  };

  const toggleRow = (key: string) => {
    setExpanded((current) => (current === key ? null : key));
  };

  const resetFilters = () => {
    setQuery("");
    setLevel("all");
  };

  const renderBody = () => {
    if (state.status === "loading") {
      return <LoadingState label={t(($) => $.settings.logs.loading)} className="flex-1 justify-center" />;
    }
    if (state.status === "failed") {
      return (
        <EmptyState title={t(($) => $.settings.logs.loadFailed)} className="flex-1 p-8">
          <Button type="button" variant="outline" size="sm" onClick={() => setState({ status: "loading" })}>
            {t(($) => $.settings.logs.retry)}
          </Button>
        </EmptyState>
      );
    }
    if (!hasEntries) {
      return (
        <EmptyState
          className="flex-1 p-8"
          icon={
            <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-muted-foreground">
              <Logs aria-hidden className="size-5" />
            </span>
          }
          title={t(($) => $.settings.logs.empty.title)}
          description={t(($) => $.settings.logs.empty.description)}
        />
      );
    }
    if (groups.length === 0) {
      return (
        <EmptyState
          className="flex-1 p-8"
          title={
            needle
              ? t(($) => $.settings.logs.noMatch.title, { query: query.trim() })
              : t(($) => $.settings.logs.noMatch.levelTitle)
          }
          description={t(($) => $.settings.logs.noMatch.description)}
        >
          <Button type="button" variant="outline" size="sm" onClick={resetFilters}>
            {needle ? t(($) => $.settings.logs.noMatch.clearSearch) : t(($) => $.settings.logs.noMatch.showAll)}
          </Button>
        </EmptyState>
      );
    }
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.map((group) => (
          <section key={group.key} aria-label={group.label}>
            <div className="sticky top-0 z-10 border-b bg-card px-3 py-1.5 text-[0.6875rem] font-medium text-muted-foreground">
              {group.label}
            </div>
            {group.rows.map((row) => (
              <LogRowView
                key={row.key}
                row={row}
                query={needle}
                open={expanded === row.key}
                onToggle={toggleRow}
              />
            ))}
          </section>
        ))}
      </div>
    );
  };

  return (
    <Tabs
      value={level}
      onValueChange={(value) => setLevel(value as LevelFilter)}
      className="flex h-full min-h-0 flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <SearchField
          value={query}
          onChange={setQuery}
          label={t(($) => $.settings.logs.searchLabel)}
          placeholder={t(($) => $.settings.logs.searchPlaceholder)}
          clearOnEscape
          className="min-w-48 flex-1"
        />
        <TabsList size="sm" aria-label={t(($) => $.settings.logs.levels.label)} className="h-7">
          {LEVEL_FILTERS.map((filter) => (
            <TabsTrigger key={filter} value={filter} className="gap-1.5">
              {t(($) => $.settings.logs.levels[filter])}
              <span className="font-mono text-[0.6875rem] text-muted-foreground">{formatNumber(counts[filter])}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        <span aria-hidden className="mx-1 h-5 w-px bg-border" />
        <TooltipIconButton
          label={t(($) => $.settings.logs.actions.export)}
          variant="outline"
          disabled={!hasEntries}
          onClick={() => void exportLogs()}
        >
          <Download aria-hidden />
        </TooltipIconButton>
        <TooltipIconButton
          label={t(($) => $.settings.logs.actions.openFolder)}
          variant="outline"
          onClick={() => void openFolder()}
        >
          <FolderOpen aria-hidden />
        </TooltipIconButton>
        <TooltipIconButton
          label={t(($) => $.settings.logs.actions.clear)}
          variant="outline"
          disabled={!hasEntries}
          onClick={() => setConfirmClear(true)}
        >
          <Trash2 aria-hidden />
        </TooltipIconButton>
      </div>
      <TabsContent
        value={level}
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card/60"
      >
        {renderBody()}
        {state.status === "ready" && hasEntries ? (
          <div className="flex shrink-0 justify-between border-t px-3 py-2 text-[0.6875rem] text-muted-foreground">
            <span>
              {visible.length === total
                ? t(($) => $.settings.logs.count, { count: total })
                : t(($) => $.settings.logs.filteredCount, { count: total, shown: visible.length })}
            </span>
            <span>{t(($) => $.settings.logs.newestFirst)}</span>
          </div>
        ) : null}
      </TabsContent>
      <ConfirmationDialog
        open={confirmClear}
        title={t(($) => $.settings.logs.clear.title)}
        description={t(($) => $.settings.logs.clear.description, { count: total })}
        confirmLabel={t(($) => $.settings.logs.clear.confirm)}
        destructive
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => void clearAll()}
      />
    </Tabs>
  );
}
