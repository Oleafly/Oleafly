import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, Copy, Download, FolderOpen, Lock, Logs, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { EmptyMedia, EmptyState, LoadingState } from "@/components/ui/empty";
import { Highlighted } from "@/components/ui/highlighted";
import { SearchField } from "@/components/ui/search-field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipIconButton } from "@/components/ui/tooltip-icon-button";
import { useCopyStatus } from "@/components/ui/use-copy-status";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ROW_WINDOW_ITEM, useRowWindow } from "@/hooks/use-row-window";
import { formatDate, formatNumber, formatTime } from "@/lib/intl";
import { logError, logWarning } from "@/lib/log";
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
  lower: string;
  fields: Field[];
  privateFields: Field[];
  haystack: string;
}

interface LogGroup {
  key: string;
  label: string;
  rows: LogRow[];
}

type ListItem = Readonly<{ group: LogGroup; row?: LogRow }>;

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

const SEARCH_DELAY_MS = 150;

const REFRESH_MS = 5_000;

function fieldsOf(value: unknown): Field[] {
  if (value === null || value === undefined) return [];
  if (typeof value !== "object" || Array.isArray(value)) return [["value", stringValue(value)]];
  return Object.entries(value).map(([key, item]) => [key, stringValue(item)] as const);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function matchRanges(lower: string, query: string): [number, number][] {
  if (!query) return [];
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

function entryText(row: LogRow): string {
  const { entry } = row;
  return [
    `${new Date(entry.ts_ms).toISOString()} ${entry.level} ${entry.message}`,
    ...row.fields.map(([key, value]) => `${key}=${value}`),
  ].join("\n");
}

function toRows(entries: readonly LogEntry[]): LogRow[] {
  const seen = new Map<number, number>();
  return entries
    .map((entry) => {
      const repeat = seen.get(entry.ts_ms) ?? 0;
      seen.set(entry.ts_ms, repeat + 1);
      const fields = fieldsOf(entry.safe);
      const privateFields = fieldsOf(entry.sensitive);
      return {
        key: `${entry.ts_ms}-${repeat}`,
        entry,
        lower: entry.message.toLowerCase(),
        fields,
        privateFields,
        haystack: `${entry.message} ${fieldText(fields)} ${fieldText(privateFields)}`.toLowerCase(),
      };
    })
    .reverse();
}

function sameEntries(left: readonly LogEntry[], right: readonly LogEntry[]): boolean {
  const last = left.at(-1);
  const next = right.at(-1);
  return (
    left.length === right.length &&
    left[0]?.ts_ms === right[0]?.ts_ms &&
    last?.ts_ms === next?.ts_ms &&
    last?.message === next?.message
  );
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
        <Button type="button" variant="outline" size="xs" onClick={() => void copy(entryText(row))}>
          <Copy aria-hidden />
          {copied ? t(($) => $.settings.logs.copied) : t(($) => $.settings.logs.copyEntry)}
        </Button>
      </div>
    </div>
  );
}

const LogRowView = memo(function LogRowView({
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
        className={cn(ROW_GRID, "h-8 w-full text-left text-xs transition-colors hover:bg-accent/40 focus-visible:bg-accent/40")}
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
          <Highlighted text={entry.message} ranges={matchRanges(row.lower, query)} />
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
});

function LogList({
  items,
  query,
  expanded,
  onToggle,
}: Readonly<{ items: readonly ListItem[]; query: string; expanded: string | null; onToggle: (key: string) => void }>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rows = useRowWindow({ count: items.length, scrollRef, listRef });
  const slice = items.slice(rows.start, rows.end);
  const lifted = slice[0]?.row ? rows.rowHeight : 0;
  const sections: { group: LogGroup; rows: LogRow[] }[] = [];
  for (const item of slice) {
    if (sections.at(-1)?.group !== item.group) sections.push({ group: item.group, rows: [] });
    if (item.row) sections.at(-1)?.rows.push(item.row);
  }
  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      <div
        ref={listRef}
        style={{ paddingTop: Math.max(0, rows.paddingTop - lifted), paddingBottom: rows.paddingBottom }}
      >
        {sections.map((section) => (
          <section key={section.group.key} aria-label={section.group.label}>
            <div
              {...{ [ROW_WINDOW_ITEM]: "" }}
              className="sticky top-0 z-10 box-content flex h-8 items-center border-b bg-card px-3 text-[0.6875rem] font-medium text-muted-foreground"
            >
              {section.group.label}
            </div>
            {section.rows.map((row) => (
              <LogRowView
                key={row.key}
                row={row}
                query={query && row.lower.includes(query) ? query : ""}
                open={expanded === row.key}
                onToggle={onToggle}
              />
            ))}
          </section>
        ))}
      </div>
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
  const reads = useRef(0);

  const loading = state.status === "loading";
  const ready = state.status === "ready";

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

  useEffect(() => {
    if (!ready) return;
    let active = true;
    let busy = false;
    let warned = false;
    const refresh = () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      const read = reads.current;
      readLogEntries()
        .then((next) => {
          warned = false;
          if (!active || read !== reads.current) return;
          setState((current) =>
            current.status === "ready" && sameEntries(current.entries, next) ? current : { status: "ready", entries: next },
          );
        })
        .catch((error) => {
          if (warned) return;
          warned = true;
          void logWarning("refresh log entries", error);
        })
        .finally(() => {
          busy = false;
        });
    };
    const timer = window.setInterval(refresh, REFRESH_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [ready]);

  const entries = state.status === "ready" ? state.entries : [];
  const rows = useMemo(() => toRows(entries), [entries]);
  const needle = useDebouncedValue(query.trim().toLowerCase(), SEARCH_DELAY_MS, (value) => value === "");
  const searched = useMemo(
    () => (needle ? rows.filter((row) => row.haystack.includes(needle)) : rows),
    [rows, needle],
  );
  const counts = useMemo<Record<LevelFilter, number>>(() => {
    let warning = 0;
    let error = 0;
    for (const row of searched) {
      if (row.entry.level === "warning") warning += 1;
      else if (row.entry.level === "error") error += 1;
    }
    return { all: searched.length, warning, error };
  }, [searched]);
  const visible = useMemo(
    () => (level === "all" ? searched : searched.filter((row) => row.entry.level === level)),
    [searched, level],
  );

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

  const items = useMemo(
    () => groups.flatMap((group): ListItem[] => [{ group }, ...group.rows.map((row) => ({ group, row }))]),
    [groups],
  );

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
    reads.current += 1;
    try {
      await clearLogs();
      setExpanded(null);
      setState({ status: "ready", entries: [] });
    } catch (error) {
      void logError("clear logs", error);
      toast.error(t(($) => $.settings.logs.toast.clearFailed));
    }
  };

  const toggleRow = useCallback((key: string) => {
    setExpanded((current) => (current === key ? null : key));
  }, []);

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
            <EmptyMedia>
              <Logs aria-hidden className="size-5" />
            </EmptyMedia>
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
    return <LogList items={items} query={needle} expanded={expanded} onToggle={toggleRow} />;
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
