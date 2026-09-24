import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { PRIMARY_TEXT, ReleaseNotes } from "@/components/layout/ReleaseNotes";
import type { ReleaseEntry, ReleaseHistoryStatus } from "@/lib/release-history";
import { cn } from "@/lib/utils";

export const HISTORY_LOAD_THRESHOLD = 0.8;

export interface ReleaseHistoryView {
  entries: ReleaseEntry[];
  status: ReleaseHistoryStatus;
  onLoadMore: () => void;
  onRetry: () => void;
}

function isBlank(char: string | undefined): boolean {
  return char === " " || char === "\t";
}

function withoutClosingHashes(text: string): string {
  let end = text.length;
  while (end > 0 && isBlank(text[end - 1])) end -= 1;
  let start = end;
  while (start > 0 && text[start - 1] === "#") start -= 1;
  if (start < end && (start === 0 || isBlank(text[start - 1]))) end = start;
  return text.slice(0, end).trim();
}

export function splitNotesTitle(notes: string | undefined): { title: string | null; body: string } {
  const source = notes?.trim() ?? "";
  const lineEnd = source.indexOf("\n");
  const firstLine = (lineEnd === -1 ? source : source.slice(0, lineEnd)).replace(/\r$/, "");
  const marker = /^#{1,2}[ \t]/.exec(firstLine);
  const title = marker ? withoutClosingHashes(firstLine.slice(marker[0].length)) : "";
  if (!title) return { title: null, body: source };
  return { title, body: lineEnd === -1 ? "" : source.slice(lineEnd + 1).trim() };
}

export function parseReleaseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2}:\d{2})/.exec(value.trim());
  if (!match) return null;
  const [, day, time] = match;
  const normalized = new Date(`${day}T${time.padStart(8, "0")}Z`);
  return Number.isNaN(normalized.getTime()) ? null : normalized;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeTimeLabel(date: Date, now: number, locale: string): string {
  const seconds = Math.round((date.getTime() - now) / 1000);
  const magnitude = Math.abs(seconds);
  let format: Intl.RelativeTimeFormat;
  try {
    format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  } catch {
    format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  }
  if (magnitude < 45) return format.format(0, "second");
  if (magnitude < 45 * MINUTE) return format.format(Math.round(seconds / MINUTE), "minute");
  if (magnitude < 22 * HOUR) return format.format(Math.round(seconds / HOUR), "hour");
  if (magnitude < 7 * DAY) return format.format(Math.round(seconds / DAY), "day");
  if (magnitude < 28 * DAY) return format.format(Math.round(seconds / (7 * DAY)), "week");
  if (magnitude < 335 * DAY) return format.format(Math.round(seconds / (30 * DAY)), "month");
  return format.format(Math.round(seconds / (365 * DAY)), "year");
}

function exactTimeLabel(date: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function RelativeTime({
  value,
  locale,
  now,
  render,
}: Readonly<{
  value: string | null | undefined;
  locale: string;
  now: () => number;
  render?: (label: string) => string;
}>) {
  const date = parseReleaseDate(value);
  if (!date) return null;
  const label = relativeTimeLabel(date, now(), locale);
  return (
    <Tooltip label={exactTimeLabel(date, locale)} side="bottom">
      <time dateTime={date.toISOString()} className="cursor-default">
        {render ? render(label) : label}
      </time>
    </Tooltip>
  );
}

const VERSION_TAG =
  "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-px font-mono text-[11px] font-medium leading-4";

export function VersionTag({ version, emphasis }: Readonly<{ version: string; emphasis?: boolean }>) {
  return (
    <span
      className={cn(
        VERSION_TAG,
        emphasis ? cn("border-primary/25 bg-primary/10", PRIMARY_TEXT) : "bg-muted/60 text-foreground",
      )}
    >
      {`v${version}`}
    </span>
  );
}

export function VersionTagButton({
  version,
  label,
  onOpen,
}: Readonly<{ version: string; label: string; onOpen: () => void }>) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`v${version}. ${label}`}
      title={label}
      className={cn(
        VERSION_TAG,
        "border-primary/25 bg-primary/10 transition-colors hover:bg-primary/15 focus-visible:bg-primary/20",
        PRIMARY_TEXT,
      )}
    >
      {`v${version}`}
      <ExternalLink aria-hidden="true" className="size-2.5 opacity-70" />
    </button>
  );
}

function TimelineNode({ emphasis, hollow }: Readonly<{ emphasis?: boolean; hollow?: boolean }>) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute left-0 top-[4px] size-[11px] rounded-full border-2",
        hollow ? "border-muted-foreground/40 bg-popover" : "border-popover",
        !hollow && (emphasis ? "bg-primary" : "bg-muted-foreground/35"),
      )}
    />
  );
}

function TimelineItem({
  sectionKey,
  entry,
  installed,
  locale,
  now,
  onOpenLink,
}: Readonly<{
  sectionKey: string;
  entry: ReleaseEntry;
  installed: boolean;
  locale: string;
  now: () => number;
  onOpenLink: (url: string) => void;
}>) {
  const { t } = useTranslation(["shell"]);
  const { body } = splitNotesTitle(entry.body);
  const viewRelease = t(($) => $.shell.updateWindow.viewRelease);
  return (
    <li
      data-release-section={sectionKey}
      data-testid="release-timeline-item"
      data-version={entry.version}
      data-installed={installed || undefined}
      className="relative pb-5 pl-6 last:pb-1"
    >
      <TimelineNode emphasis={installed} />
      <div className="mb-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        <VersionTag version={entry.version} emphasis={installed} />
        <RelativeTime value={entry.publishedAt} locale={locale} now={now} />
        {installed && (
          <span data-testid="installed-release" className={cn("font-medium", PRIMARY_TEXT)}>
            {t(($) => $.shell.changelog.installed)}
          </span>
        )}
        <button
          type="button"
          onClick={() => onOpenLink(entry.url)}
          aria-label={viewRelease}
          title={viewRelease}
          className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground"
        >
          <ExternalLink aria-hidden="true" className="size-3" />
        </button>
      </div>
      {body ? <ReleaseNotes source={body} onOpenLink={onOpenLink} /> : null}
    </li>
  );
}

export function ReleaseTimeline({
  scrollRef,
  history,
  lead,
  installedVersion,
  endLabel,
  locale,
  now = Date.now,
  onOpenLink,
}: Readonly<{
  scrollRef: RefObject<HTMLElement | null>;
  history?: ReleaseHistoryView;
  lead?: { version: string; content: ReactNode };
  installedVersion?: string;
  endLabel?: string | null;
  locale: string;
  now?: () => number;
  onOpenLink: (url: string) => void;
}>) {
  const { t } = useTranslation(["common", "shell"]);
  const listRef = useRef<HTMLOListElement>(null);
  const status = history?.status;
  const onLoadMore = history?.onLoadMore;

  const loadMoreWhenNearEnd = useCallback(() => {
    const scroller = scrollRef.current;
    const list = listRef.current;
    if (!scroller || !list || !onLoadMore || status !== "idle") return;
    const sections = list.querySelectorAll<HTMLElement>("[data-release-section]");
    const current = sections[sections.length - 1];
    if (!current) {
      onLoadMore();
      return;
    }
    const viewport = scroller.getBoundingClientRect();
    const section = current.getBoundingClientRect();
    if (section.top + section.height * HISTORY_LOAD_THRESHOLD <= viewport.bottom) onLoadMore();
  }, [onLoadMore, scrollRef, status]);

  useEffect(() => {
    loadMoreWhenNearEnd();
    const scroller = scrollRef.current;
    const list = listRef.current;
    scroller?.addEventListener("scroll", loadMoreWhenNearEnd, { passive: true });
    const observer =
      list && typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => loadMoreWhenNearEnd()) : null;
    if (list) observer?.observe(list);
    return () => {
      scroller?.removeEventListener("scroll", loadMoreWhenNearEnd);
      observer?.disconnect();
    };
  }, [loadMoreWhenNearEnd, scrollRef]);

  return (
    <ol ref={listRef} data-testid="release-timeline" className="relative">
      <span aria-hidden="true" className="absolute bottom-2 left-[5px] top-2 w-px bg-border" />
      {lead && (
        <li
          data-release-section="latest"
          data-testid="release-timeline-item"
          data-version={lead.version}
          className="relative pb-5 pl-6 last:pb-1"
        >
          <TimelineNode emphasis />
          {lead.content}
        </li>
      )}
      {history?.entries.map((entry) => (
        <TimelineItem
          key={entry.version}
          sectionKey={entry.version}
          entry={entry}
          installed={Boolean(installedVersion) && entry.version === installedVersion}
          locale={locale}
          now={now}
          onOpenLink={onOpenLink}
        />
      ))}
      {history?.status === "loading" && (
        <li aria-busy="true" className="relative pb-1 pl-6">
          <span
            aria-hidden="true"
            className="absolute left-0 top-[4px] size-[11px] rounded-full border-2 border-popover bg-muted-foreground/20"
          />
          <div className="space-y-2 pt-0.5">
            <div className="h-3.5 w-14 rounded bg-muted motion-safe:animate-pulse" />
            <div className="h-2.5 w-full rounded bg-muted motion-safe:animate-pulse" />
            <div className="h-2.5 w-4/5 rounded bg-muted motion-safe:animate-pulse" />
          </div>
        </li>
      )}
      {history?.status === "error" && (
        <li className="relative pb-1 pl-6">
          <span
            aria-hidden="true"
            className="absolute left-0 top-[9px] size-[11px] rounded-full border-2 border-popover bg-muted-foreground/35"
          />
          <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
            <p className="text-xs text-muted-foreground">{t(($) => $.shell.updateWindow.historyFailed)}</p>
            <Button variant="secondary" size="sm" onClick={history.onRetry}>
              <RotateCcw aria-hidden="true" className="size-3.5" />
              {t(($) => $.common.actions.retry)}
            </Button>
          </div>
        </li>
      )}
      {history?.status === "done" && endLabel && (
        <li data-testid="release-history-end" className="relative pl-6">
          <TimelineNode hollow />
          <p className="text-[11px] text-muted-foreground">{endLabel}</p>
        </li>
      )}
    </ol>
  );
}
