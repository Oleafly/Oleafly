import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, ExternalLink, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { PRIMARY_TEXT, ReleaseNotes } from "@/components/layout/ReleaseNotes";
import {
  inAppReleaseNotes,
  leadStaysVisible,
  outlineReleaseNotes,
  releaseSectionFolds,
  withoutClosingHashes,
  type ReleaseNotesOutline,
  type ReleaseNotesSection,
} from "@/components/layout/release-notes-outline";
import type { ReleaseEntry, ReleaseHistoryStatus } from "@/lib/release-history";
import { cn } from "@/lib/utils";

export const HISTORY_LOAD_THRESHOLD = 0.8;

export interface ReleaseHistoryView {
  entries: ReleaseEntry[];
  status: ReleaseHistoryStatus;
  onLoadMore: () => void;
  onRetry: () => void;
}

function leadingTitle(text: string): { title: string; rest: string } {
  const lineEnd = text.indexOf("\n");
  const firstLine = lineEnd === -1 ? text : text.slice(0, lineEnd);
  const marker = /^#{1,2}[ \t]/.exec(firstLine);
  const title = marker ? withoutClosingHashes(firstLine.slice(marker[0].length)) : "";
  return { title, rest: lineEnd === -1 ? "" : text.slice(lineEnd + 1).trim() };
}

export function splitNotesTitle(notes: string | undefined): { title: string | null; body: string } {
  const source = inAppReleaseNotes(notes);
  const { title, rest } = leadingTitle(source);
  if (!title) return { title: null, body: source };
  const repeated = leadingTitle(rest);
  return { title, body: repeated.title === title ? repeated.rest : rest };
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
  "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-px font-mono text-[0.6875rem] font-medium leading-4";

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

const DISCLOSURE =
  "-mx-1.5 flex max-w-[calc(100%+0.75rem)] items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground";

function DisclosureChevron({ open }: Readonly<{ open: boolean }>) {
  return (
    <ChevronRight
      aria-hidden="true"
      className={cn("size-3.5 shrink-0 text-muted-foreground motion-safe:transition-transform", open && "rotate-90")}
    />
  );
}

function ReleaseSection({
  section,
  onOpenLink,
}: Readonly<{ section: ReleaseNotesSection; onOpenLink: (url: string) => void }>) {
  const { t } = useTranslation(["shell"]);
  const folds = releaseSectionFolds(section);
  const [open, setOpen] = useState(!folds);
  const contentId = useId();
  const headingClass = "mb-1.5 text-sm font-semibold text-foreground";
  return (
    <section data-release-notes-section={section.heading} className="mt-4 first:mt-0">
      {folds ? (
        <h3 className={headingClass}>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={contentId}
            onClick={() => setOpen((value) => !value)}
            className={DISCLOSURE}
          >
            <DisclosureChevron open={open} />
            <span>{section.heading}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {t(($) => $.shell.changelog.sectionItems, { count: section.items })}
            </span>
          </button>
        </h3>
      ) : (
        <h3 className={headingClass}>{section.heading}</h3>
      )}
      <div id={contentId} hidden={!open}>
        {open && section.body ? <ReleaseNotes source={section.body} onOpenLink={onOpenLink} /> : null}
      </div>
    </section>
  );
}

function keyedSections(sections: readonly ReleaseNotesSection[]) {
  const seen = new Map<string, number>();
  return sections.map((section) => {
    const occurrence = (seen.get(section.heading) ?? 0) + 1;
    seen.set(section.heading, occurrence);
    return { key: `${section.heading}#${occurrence}`, section };
  });
}

function OutlinedReleaseNotes({
  outline,
  showLead = true,
  onOpenLink,
}: Readonly<{ outline: ReleaseNotesOutline; showLead?: boolean; onOpenLink: (url: string) => void }>) {
  return (
    <>
      {showLead && outline.lead ? (
        <ReleaseNotes source={outline.lead} onOpenLink={onOpenLink} className={outline.sections.length ? "mb-3" : undefined} />
      ) : null}
      {keyedSections(outline.sections).map(({ key, section }) => (
        <ReleaseSection key={key} section={section} onOpenLink={onOpenLink} />
      ))}
    </>
  );
}

export function ReleaseNotesBody({
  source,
  onOpenLink,
}: Readonly<{ source: string; onOpenLink: (url: string) => void }>) {
  const outline = useMemo(() => outlineReleaseNotes(source), [source]);
  return <OutlinedReleaseNotes outline={outline} onOpenLink={onOpenLink} />;
}

function releaseSummary(outline: ReleaseNotesOutline): string {
  return outline.sections
    .map((section) => (section.items > 0 ? `${section.heading} ${section.items}` : section.heading))
    .join(" · ");
}

function FoldableReleaseNotes({
  body,
  defaultExpanded,
  onOpenLink,
}: Readonly<{ body: string; defaultExpanded: boolean; onOpenLink: (url: string) => void }>) {
  const { t } = useTranslation(["shell"]);
  const outline = useMemo(() => outlineReleaseNotes(body), [body]);
  const [toggled, setToggled] = useState<boolean | null>(null);
  const contentId = useId();
  const leadVisible = leadStaysVisible(outline.lead);
  const foldable = outline.sections.length > 0 || Boolean(outline.lead && !leadVisible);
  if (defaultExpanded || !foldable) return <OutlinedReleaseNotes outline={outline} onOpenLink={onOpenLink} />;
  const expanded = toggled ?? false;
  return (
    <>
      {leadVisible ? <ReleaseNotes source={outline.lead} onOpenLink={onOpenLink} className="mb-1.5" /> : null}
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setToggled(!expanded)}
        className={cn(DISCLOSURE, "text-xs text-muted-foreground")}
      >
        <DisclosureChevron open={expanded} />
        <span className="min-w-0 truncate">{releaseSummary(outline) || t(($) => $.shell.changelog.showNotes)}</span>
      </button>
      <div id={contentId} hidden={!expanded} className="mt-2">
        {expanded ? <OutlinedReleaseNotes outline={outline} showLead={!leadVisible} onOpenLink={onOpenLink} /> : null}
      </div>
    </>
  );
}

function TimelineItem({
  sectionKey,
  entry,
  installed,
  defaultExpanded,
  locale,
  now,
  onOpenLink,
}: Readonly<{
  sectionKey: string;
  entry: ReleaseEntry;
  installed: boolean;
  defaultExpanded: boolean;
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
      <div className="mb-1.5 flex items-center gap-2 text-[0.6875rem] text-muted-foreground">
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
      {body ? <FoldableReleaseNotes body={body} defaultExpanded={defaultExpanded} onOpenLink={onOpenLink} /> : null}
    </li>
  );
}

const EXPAND_EVERY_RELEASE = () => true;

export function ReleaseTimeline({
  scrollRef,
  history,
  lead,
  installedVersion,
  expandRelease = EXPAND_EVERY_RELEASE,
  endLabel,
  locale,
  now = Date.now,
  onOpenLink,
}: Readonly<{
  scrollRef: RefObject<HTMLElement | null>;
  history?: ReleaseHistoryView;
  lead?: { version: string; content: ReactNode };
  installedVersion?: string;
  expandRelease?: (entry: ReleaseEntry, index: number) => boolean;
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
      {history?.entries.map((entry, index) => (
        <TimelineItem
          key={entry.version}
          sectionKey={entry.version}
          entry={entry}
          installed={Boolean(installedVersion) && entry.version === installedVersion}
          defaultExpanded={expandRelease(entry, index)}
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
          <p className="text-[0.6875rem] text-muted-foreground">{endLabel}</p>
        </li>
      )}
    </ol>
  );
}
