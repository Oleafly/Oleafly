import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DailyAreaChart, type DailyAreaPoint } from "@/components/ui/daily-area-chart";
import { WeekHourHeatmap, type HeatmapCell } from "@/components/ui/week-hour-heatmap";
import { formatDate, formatNumber } from "@/lib/intl";
import type { CollabDailyActivity, CollabServerActivity } from "@/lib/tauri";

const DAY_MS = 86_400_000;
const MAX_DAYS = 366;
const A_SUNDAY = Date.UTC(2023, 0, 1);

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function activityDays(activity: CollabServerActivity): CollabDailyActivity[] {
  const known = new Map(activity.daily.map((day) => [day.day, day]));
  const count = Math.min(Math.max(0, Math.floor(activity.days)), MAX_DAYS);
  return Array.from({ length: count }, (_, index) => {
    const day = activity.since + index * DAY_MS;
    return known.get(day) ?? { day, sign_ins: 0, people: 0 };
  });
}

function weekdayNames(): string[] {
  return Array.from({ length: 7 }, (_, index) =>
    formatDate(A_SUNDAY + index * DAY_MS, { weekday: "short", timeZone: "UTC" }),
  );
}

function SignInTrend({ days }: Readonly<{ days: readonly CollabDailyActivity[] }>) {
  const { t } = useTranslation(["collab"]);
  const points = useMemo(
    () =>
      days.map(
        (day): DailyAreaPoint => ({ day: isoDay(day.day), value: day.sign_ins, marked: day.sign_ins > 0 }),
      ),
    [days],
  );
  return (
    <div>
      <DailyAreaChart
        points={points}
        label={t(($) => $.collab.console.overview.activity.dailyLabel)}
        title={t(($) => $.collab.console.overview.activity.daily)}
        renderReading={(index) => (
          <>
            <span className="block tabular-nums text-muted-foreground">
              {t(($) => $.collab.console.overview.activity.signIns, {
                number: formatNumber(days[index].sign_ins),
              })}
            </span>
            <span className="block tabular-nums text-muted-foreground">
              {t(($) => $.collab.console.overview.activity.people, { number: formatNumber(days[index].people) })}
            </span>
          </>
        )}
      />
      <table className="sr-only">
        <caption>{t(($) => $.collab.console.overview.activity.daily)}</caption>
        <thead>
          <tr>
            <th>{t(($) => $.collab.console.overview.activity.day)}</th>
            <th>{t(($) => $.collab.console.overview.activity.signInsColumn)}</th>
            <th>{t(($) => $.collab.console.overview.activity.peopleColumn)}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point, index) => (
            <tr key={point.day}>
              <td>{point.day}</td>
              <td>{days[index].sign_ins}</td>
              <td>{days[index].people}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SignInHeatmap({ activity }: Readonly<{ activity: CollabServerActivity }>) {
  const { t } = useTranslation(["collab"]);
  const cells = activity.by_hour.map(
    (cell): HeatmapCell => ({ weekday: cell.weekday, hour: cell.hour, value: cell.sign_ins }),
  );
  return (
    <WeekHourHeatmap
      cells={cells}
      weekdays={weekdayNames()}
      label={t(($) => $.collab.console.overview.activity.hourlyLabel)}
      describe={(weekday, hour, cell) =>
        t(($) => $.collab.console.overview.activity.cell, {
          weekday,
          hour,
          number: formatNumber(cell?.value ?? 0),
        })
      }
      legend={{
        note: t(($) => $.collab.console.overview.activity.hoursInUtc),
        less: t(($) => $.collab.console.overview.activity.less),
        more: t(($) => $.collab.console.overview.activity.more),
      }}
    />
  );
}

export function OverviewActivity({ activity }: Readonly<{ activity: CollabServerActivity }>) {
  const { t } = useTranslation(["collab"]);
  const days = useMemo(() => activityDays(activity), [activity]);
  const total = days.reduce((sum, day) => sum + day.sign_ins, 0);
  const dailyId = useId();
  const hourlyId = useId();
  return (
    <div className="space-y-3" data-testid="console-activity">
      <p className="text-xs text-muted-foreground">{t(($) => $.collab.console.overview.activity.description)}</p>
      {total === 0 ? (
        <p className="text-xs text-muted-foreground">{t(($) => $.collab.console.overview.activity.none)}</p>
      ) : null}
      <div className="grid gap-4 @3xl:grid-cols-2">
        <section aria-labelledby={dailyId} className="min-w-0 rounded-lg border bg-card p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h4 id={dailyId} className="text-sm font-medium">
              {t(($) => $.collab.console.overview.activity.daily)}
            </h4>
            <span className="text-xs tabular-nums text-muted-foreground" data-testid="console-activity-total">
              {t(($) => $.collab.console.overview.activity.total, { number: formatNumber(total) })}
            </span>
          </div>
          <SignInTrend days={days} />
        </section>
        <section aria-labelledby={hourlyId} className="min-w-0 overflow-x-auto rounded-lg border bg-card p-4">
          <h4 id={hourlyId} className="mb-3 text-sm font-medium">
            {t(($) => $.collab.console.overview.activity.hourly)}
          </h4>
          <SignInHeatmap activity={activity} />
        </section>
      </div>
    </div>
  );
}
