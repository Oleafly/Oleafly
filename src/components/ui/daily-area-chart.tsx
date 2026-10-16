import { useMemo, useState, type ReactNode } from "react";
import { formatDate } from "@/lib/intl";

// One UTC day on the chart. A null value is a day whose amount isn't known:
// the line breaks there instead of dropping to zero. A marked day gets a dot.
export type DailyAreaPoint = Readonly<{
  day: string;
  value: number | null;
  marked?: boolean;
}>;

const TICK_STEPS = [1, 2, 3, 7, 14, 30, 60, 90];
const BASELINE = 37;
const HEIGHT = 33;

// A day such as "2026-08-01", or a time in milliseconds, as a short UTC date.
export function formatUtcDay(value: number | string, withYear = false): string {
  const date = typeof value === "string" ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
  return formatDate(date, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

function tickStep(length: number): number {
  return TICK_STEPS.find((step) => Math.ceil(length / step) <= 7) ?? TICK_STEPS.at(-1) ?? 90;
}

function tickTransform(position: number, x: number): string {
  if (position === 0) return "none";
  if (x > 92) return "translateX(-100%)";
  return "translateX(-50%)";
}

function geometry(points: readonly DailyAreaPoint[]) {
  const max = Math.max(1, ...points.map((point) => point.value ?? 0));
  const count = points.length;
  const x = (index: number) => (count === 1 ? 50 : (index / (count - 1)) * 100);
  const y = (value: number) => BASELINE - (value / max) * HEIGHT;
  const plotted = points.map((point, index) =>
    point.value === null ? null : { x: x(index), y: y(point.value) },
  );
  const segments: Array<{ line: string; area: string }> = [];
  let current: Array<{ x: number; y: number }> = [];
  const flush = () => {
    if (current.length > 0) {
      const coordinates = current.map((point) => `${point.x},${point.y}`);
      const first = current[0];
      const last = current.at(-1) ?? first;
      segments.push({
        line: coordinates.join(" "),
        area: `M${first.x},${BASELINE} L${coordinates.join(" L")} L${last.x},${BASELINE} Z`,
      });
    }
    current = [];
  };
  for (const point of plotted) {
    if (point === null) flush();
    else current.push(point);
  }
  flush();
  const step = tickStep(count);
  const ticks: Array<{ index: number; x: number }> = [];
  for (let index = 0; index < count; index += step) ticks.push({ index, x: x(index) });
  return { plotted, segments, ticks, x };
}

// A filled line of one amount per UTC day, with a date axis and a reading of
// the day under the pointer. Callers add a screen reader table of the same
// days, since the drawing itself is one image.
export function DailyAreaChart({
  points,
  label,
  title,
  reading,
}: Readonly<{
  points: readonly DailyAreaPoint[];
  label: string;
  title: string;
  reading: (index: number) => ReactNode;
}>) {
  const [hover, setHover] = useState<number | null>(null);
  const chart = useMemo(() => geometry(points), [points]);
  const hovered = hover === null ? null : points[hover];

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover only reveals a reading; the table below carries the data */}
      <div
        className="relative"
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          if (rect.width <= 0) return;
          const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
          setHover(Math.round(ratio * (points.length - 1)));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <svg
          viewBox="0 0 100 40"
          preserveAspectRatio="none"
          className="h-40 w-full overflow-visible"
          role="img"
          aria-label={label}
        >
          <title>{title}</title>
          {[0.25, 0.5, 0.75].map((fraction) => (
            <line
              key={fraction}
              x1="0"
              y1={BASELINE - fraction * HEIGHT}
              x2="100"
              y2={BASELINE - fraction * HEIGHT}
              className="stroke-border/60"
              strokeDasharray="1 1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <line
            x1="0"
            y1={BASELINE}
            x2="100"
            y2={BASELINE}
            className="stroke-border"
            vectorEffect="non-scaling-stroke"
          />
          {chart.segments.map((segment) => (
            <path key={segment.area} d={segment.area} className="fill-primary/15" />
          ))}
          {chart.segments.map((segment) => (
            <polyline
              key={segment.line}
              points={segment.line}
              fill="none"
              vectorEffect="non-scaling-stroke"
              className="stroke-primary"
              strokeWidth="1.75"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {chart.plotted.map((point, index) =>
            point === null || !points[index].marked ? null : (
              <circle
                key={points[index].day}
                cx={point.x}
                cy={point.y}
                r="1.6"
                vectorEffect="non-scaling-stroke"
                className="fill-primary stroke-card"
                strokeWidth="1"
              />
            ),
          )}
          {hover !== null && (
            <line
              x1={chart.x(hover)}
              y1="2"
              x2={chart.x(hover)}
              y2={BASELINE}
              className="stroke-foreground/40"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {hovered && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 rounded-md border bg-popover px-2 py-1 text-[0.6875rem] text-popover-foreground shadow-md motion-safe:transition-opacity"
            style={{
              left: `${chart.x(hover ?? 0)}%`,
              transform: `translateX(${(hover ?? 0) > points.length / 2 ? "calc(-100% - 8px)" : "8px"})`,
            }}
          >
            <p className="font-medium">{formatUtcDay(hovered.day, true)}</p>
            {reading(hover ?? 0)}
          </div>
        )}
      </div>
      <div className="relative mt-1 h-4 text-[0.625rem] text-muted-foreground">
        {chart.ticks.map((tick, position) => (
          <span
            key={tick.index}
            className="absolute top-0 whitespace-nowrap"
            style={{
              left: `${tick.x}%`,
              transform: tickTransform(position, tick.x),
            }}
          >
            {formatUtcDay(points[tick.index].day)}
          </span>
        ))}
      </div>
    </>
  );
}
