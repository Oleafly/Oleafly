import type { ReactNode } from "react";

// One weekday and hour with something recorded. Weekday 0 is Sunday. A null
// value is an hour with activity whose amount isn't known.
export type HeatmapCell = Readonly<{
  weekday: number;
  hour: number;
  value: number | null;
}>;

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const LEGEND_STEPS = [0.15, 0.36, 0.57, 0.78, 1];

function cellTone(cell: HeatmapCell | undefined): string {
  if (cell === undefined) return "fill-muted";
  if (cell.value === null) return "fill-muted-foreground/30";
  return "fill-primary";
}

// A weekday by hour grid, darker where more happened, with a Less to More
// legend. `describe` words one cell for its hover title and for the screen
// reader list of every cell with activity.
export function WeekHourHeatmap({
  cells,
  weekdays,
  label,
  describe,
  legend,
}: Readonly<{
  cells: readonly HeatmapCell[];
  // Seven short names, Sunday first.
  weekdays: readonly string[];
  label: string;
  describe: (weekday: string, hour: number, cell: HeatmapCell | undefined) => string;
  legend: Readonly<{ note: string; less: string; more: string }>;
}>) {
  const byHour = new Map(cells.map((cell) => [`${cell.weekday}:${cell.hour}`, cell]));
  const maximum = Math.max(1, ...cells.map((cell) => cell.value ?? 0));
  return (
    <div>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: "2.25rem repeat(24, minmax(0, 1fr))" }}
        role="img"
        aria-label={label}
      >
        <span />
        {HOURS.map((hour) => (
          <span key={`hour-${hour}`} className="text-center text-[0.5625rem] text-muted-foreground">
            {hour % 6 === 0 ? hour : ""}
          </span>
        ))}
        {weekdays.flatMap((weekday, weekdayIndex) => {
          const row: ReactNode[] = [
            <span key={weekday} className="text-[0.625rem] leading-4 text-muted-foreground">
              {weekday}
            </span>,
          ];
          for (const hour of HOURS) {
            const cell = byHour.get(`${weekdayIndex}:${hour}`);
            const intensity =
              cell === undefined || cell.value === null ? 0 : 0.15 + (cell.value / maximum) * 0.85;
            row.push(
              <svg key={`${weekday}:${hour}`} viewBox="0 0 10 10" className="block aspect-square w-full">
                <title>{describe(weekday, hour, cell)}</title>
                <rect
                  width="10"
                  height="10"
                  rx="1.5"
                  className={cellTone(cell)}
                  style={intensity > 0 ? { opacity: intensity } : undefined}
                />
              </svg>,
            );
          }
          return row;
        })}
      </div>
      <div className="mt-2 flex items-center justify-between text-[0.625rem] text-muted-foreground">
        <span>{legend.note}</span>
        <span className="flex items-center gap-1">
          {legend.less}
          {LEGEND_STEPS.map((opacity) => (
            <span key={opacity} className="inline-block size-2.5 rounded-[2px] bg-primary" style={{ opacity }} />
          ))}
          {legend.more}
        </span>
      </div>
      <ul className="sr-only">
        {cells.map((cell) => (
          <li key={`${cell.weekday}:${cell.hour}`}>
            {describe(weekdays[cell.weekday] ?? String(cell.weekday), cell.hour, cell)}
          </li>
        ))}
      </ul>
    </div>
  );
}
