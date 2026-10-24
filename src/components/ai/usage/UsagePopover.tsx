import { useEffect, useRef, useState, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { Progress } from "@/components/ui/progress";
import { currentLocale } from "@/i18n";
import { formatUsd } from "@/lib/ai-pricing";
import { formatNumber, formatRelativeTime } from "@/lib/intl";
import type { UsageSnapshot, UsageWindow } from "./types";
import { contextFraction, USAGE_TONE_BAR, usageTone, windowTone } from "./usage-tone";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function money(value: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat(currentLocale(), {
      style: "currency",
      currency,
      maximumFractionDigits: value < 1 ? 3 : 2,
    }).format(value);
  } catch {
    return `${formatNumber(value)} ${currency}`;
  }
}

/** "in 3 hours" for a time ahead of now. */
function untilLabel(at: number, now: number): string {
  const ahead = Math.max(0, at - now);
  if (ahead < HOUR_MS) return formatRelativeTime(Math.max(1, Math.round(ahead / MINUTE_MS)), "minute");
  if (ahead < 2 * DAY_MS) return formatRelativeTime(Math.round(ahead / HOUR_MS), "hour");
  return formatRelativeTime(Math.round(ahead / DAY_MS), "day");
}

function merge(snapshot: UsageSnapshot, extras: Partial<UsageSnapshot>): UsageSnapshot {
  const merged: UsageSnapshot = { ...snapshot, ...extras };
  if (snapshot.session || extras.session) {
    merged.session = { ...snapshot.session, ...extras.session };
  }
  if (snapshot.notes || extras.notes) {
    merged.notes = [...(snapshot.notes ?? []), ...(extras.notes ?? [])];
  }
  return merged;
}

function Bar({ fraction, tone, label }: Readonly<{ fraction: number; tone: keyof typeof USAGE_TONE_BAR; label: string }>) {
  return <Progress value={fraction * 100} label={label} indicatorClassName={USAGE_TONE_BAR[tone]} />;
}

function Rows({ rows }: Readonly<{ rows: [string, ReactNode][] }>) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt>{label}</dt>
          <dd className="text-right tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({
  testId,
  title,
  children,
}: Readonly<{ testId: string; title: string; children: ReactNode }>) {
  return (
    <section data-testid={testId} className="space-y-1.5 border-t pt-3 first:border-t-0 first:pt-0">
      <div className="font-medium text-foreground">{title}</div>
      {children}
    </section>
  );
}

function PlanWindow({ window, now }: Readonly<{ window: UsageWindow; now: number }>) {
  const { t } = useTranslation(["common", "ai"]);
  const tone = windowTone(window);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-foreground">{window.label}</span>
        <span className="flex shrink-0 items-center gap-1.5 tabular-nums text-muted-foreground">
          {window.status === "blocked" && (
            <Badge variant="destructive" size="sm">
              {t(($) => $.ai.usage.windowBlocked)}
            </Badge>
          )}
          {window.status === "warning" && (
            <Badge variant="warning" size="sm">
              {t(($) => $.ai.usage.windowWarning)}
            </Badge>
          )}
          {formatNumber(window.utilization, { style: "percent", maximumFractionDigits: 0 })}
        </span>
      </div>
      <Bar fraction={window.utilization} tone={tone} label={window.label} />
      {window.resetsAt !== undefined && (
        <div className="text-[0.625rem] text-muted-foreground">
          {t(($) => $.ai.usage.resetsAt, { time: untilLabel(window.resetsAt, now) })}
        </div>
      )}
    </div>
  );
}

type Translate = TFunction<["common", "ai"]>;

function contextSection(usage: UsageSnapshot, t: Translate): ReactNode {
  const { context } = usage;
  if (!context) return null;
  const fraction = contextFraction(usage);
  return (
    <Section key="context" testId="usage-context" title={t(($) => $.ai.usage.context)}>
      {fraction === null ? (
        <p className="text-muted-foreground">{t(($) => $.ai.usage.contextUnknown)}</p>
      ) : (
        <>
          <Bar fraction={fraction} tone={usageTone(fraction)} label={t(($) => $.ai.usage.context)} />
          <p className="tabular-nums text-muted-foreground">
            {t(($) => $.ai.usage.contextUsed, {
              used: formatNumber(context.used),
              size: formatNumber(context.size),
            })}
          </p>
        </>
      )}
    </Section>
  );
}

function lastRunSection(usage: UsageSnapshot, t: Translate): ReactNode {
  const last = usage.lastTurn;
  if (!last || !(last.inputTokens !== undefined || last.outputTokens !== undefined || last.steps)) return null;
  const unknown = t(($) => $.common.state.unknown);
  const count = (value: number | undefined) => (value === undefined ? unknown : formatNumber(value));
  const rows: [string, ReactNode][] = [];
  if (last.steps !== undefined) rows.push([t(($) => $.ai.usage.steps), formatNumber(last.steps)]);
  rows.push([t(($) => $.ai.usage.input), count(last.inputTokens)], [t(($) => $.ai.usage.output), count(last.outputTokens)]);
  if (last.thoughtTokens !== undefined) {
    rows.push([t(($) => $.ai.usage.reasoning), formatNumber(last.thoughtTokens)]);
  }
  return (
    <Section key="last" testId="ai-run-usage" title={t(($) => $.ai.usage.lastRun)}>
      <Rows rows={rows} />
    </Section>
  );
}

type SessionUsage = NonNullable<UsageSnapshot["session"]>;

function sessionTokenTotal(session: SessionUsage): number {
  return (session.inputTokens ?? 0) + (session.outputTokens ?? 0);
}

/** The chat has run something, so its totals are worth showing. */
function sessionHasUsage(session: SessionUsage): boolean {
  return sessionTokenTotal(session) > 0 || (session.steps ?? 0) > 0 || (session.costUsd ?? 0) > 0;
}

function sessionRows(session: SessionUsage, t: Translate): [string, ReactNode][] {
  const rows: [string, ReactNode][] = [];
  if (session.turns !== undefined) rows.push([t(($) => $.ai.usage.runs), formatNumber(session.turns)]);
  if (session.steps !== undefined) rows.push([t(($) => $.ai.usage.steps), formatNumber(session.steps)]);
  rows.push([t(($) => $.ai.usage.tokens), formatNumber(sessionTokenTotal(session))]);
  if (session.thoughtTokens !== undefined) {
    rows.push([t(($) => $.ai.usage.reasoning), formatNumber(session.thoughtTokens)]);
  }
  if (session.cachedReadTokens !== undefined) {
    rows.push([t(($) => $.ai.usage.cacheRead), formatNumber(session.cachedReadTokens)]);
  }
  if (session.cachedWriteTokens !== undefined) {
    rows.push([t(($) => $.ai.usage.cacheWrite), formatNumber(session.cachedWriteTokens)]);
  }
  if ((session.costUsd ?? 0) > 0) rows.push([t(($) => $.ai.usage.cost), formatUsd(session.costUsd ?? 0)]);
  return rows;
}

function sessionSection(usage: UsageSnapshot, t: Translate): ReactNode {
  const { session } = usage;
  if (!session || !sessionHasUsage(session)) return null;
  return (
    <Section key="session" testId="ai-chat-usage" title={t(($) => $.ai.usage.thisChat)}>
      <Rows rows={sessionRows(session, t)} />
    </Section>
  );
}

function planSection(usage: UsageSnapshot, t: Translate, now: number): ReactNode {
  const { plan } = usage;
  if (!plan || plan.windows.length === 0) return null;
  return (
    <Section key="plan" testId="usage-plan" title={plan.label ?? t(($) => $.ai.usage.planLimits)}>
      <div className="space-y-2">
        {plan.windows.map((window) => (
          <PlanWindow key={window.id} window={window} now={now} />
        ))}
      </div>
    </Section>
  );
}

function creditSection(usage: UsageSnapshot, t: Translate): ReactNode {
  const { credit } = usage;
  if (credit?.remainingUsd === undefined) return null;
  const currency = credit.currency ?? "USD";
  return (
    <Section key="credit" testId="usage-credit" title={t(($) => $.ai.usage.credit)}>
      <p className="tabular-nums text-muted-foreground">
        {credit.limitUsd !== undefined
          ? t(($) => $.ai.usage.creditOf, {
              remaining: money(credit.remainingUsd, currency),
              limit: money(credit.limitUsd, currency),
            })
          : money(credit.remainingUsd, currency)}
      </p>
    </Section>
  );
}

function budgetSection(usage: UsageSnapshot, t: Translate): ReactNode {
  if (!usage.budget) return null;
  const { spentUsd, limitUsd } = usage.budget;
  return (
    <Section key="budget" testId="usage-budget" title={t(($) => $.ai.usage.budget)}>
      {limitUsd !== undefined && limitUsd > 0 && (
        <Bar fraction={spentUsd / limitUsd} tone={usageTone(spentUsd / limitUsd)} label={t(($) => $.ai.usage.budget)} />
      )}
      <p className="tabular-nums text-muted-foreground">
        {limitUsd !== undefined
          ? t(($) => $.ai.usage.budgetUsed, { spent: money(spentUsd), limit: money(limitUsd) })
          : money(spentUsd)}
      </p>
    </Section>
  );
}

function planMarkdownSection(usage: UsageSnapshot): ReactNode {
  if (!usage.planMarkdown) return null;
  return (
    <section key="markdown" data-testid="usage-plan-markdown" className="border-t pt-3 first:border-t-0 first:pt-0">
      <Markdown className="text-xs">{usage.planMarkdown}</Markdown>
    </section>
  );
}

/** The extras `loadExtras` fetches once, when the popover opens. */
function useUsageExtras(loadExtras: (() => Promise<Partial<UsageSnapshot>>) | undefined): Partial<UsageSnapshot> {
  const [extras, setExtras] = useState<Partial<UsageSnapshot>>({});
  const loadRef = useRef(loadExtras);
  loadRef.current = loadExtras;
  useEffect(() => {
    let cancelled = false;
    const load = loadRef.current;
    if (!load) return;
    load().then(
      (value) => {
        if (!cancelled) setExtras(value);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return extras;
}

/** The usage popover's body; loaded the first time the meter opens. */
export function UsagePopover({
  snapshot,
  loadExtras,
  onRefreshPlan,
  refreshing = false,
}: Readonly<{
  snapshot: UsageSnapshot;
  loadExtras?: () => Promise<Partial<UsageSnapshot>>;
  onRefreshPlan?: () => void;
  refreshing?: boolean;
}>) {
  const { t } = useTranslation(["common", "ai"]);
  const extras = useUsageExtras(loadExtras);
  const usage = merge(snapshot, extras);
  const now = Date.now();
  const sections = [
    contextSection(usage, t),
    lastRunSection(usage, t),
    sessionSection(usage, t),
    planSection(usage, t, now),
    creditSection(usage, t),
    budgetSection(usage, t),
    planMarkdownSection(usage),
  ].filter((section) => section !== null);

  return (
    <div data-testid="ai-usage-popover" className="space-y-3 p-3 text-xs">
      {sections.length > 0 ? sections : <p className="text-muted-foreground">{t(($) => $.ai.usage.empty)}</p>}
      {onRefreshPlan && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="w-full"
          disabled={refreshing}
          onClick={onRefreshPlan}
        >
          {refreshing ? t(($) => $.ai.usage.refreshing) : t(($) => $.ai.usage.refreshPlan)}
        </Button>
      )}
      {usage.notes && usage.notes.length > 0 && (
        <ul
          data-testid="usage-notes"
          className="space-y-1 border-t pt-2 text-[0.625rem] leading-relaxed text-muted-foreground"
        >
          {usage.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default UsagePopover;
