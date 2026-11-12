import { cn } from "@/lib/utils";

const RING_COUNT = 11;
const FIRST_RADIUS = 90;
const RING_GAP = 64;
const RINGS = Array.from({ length: RING_COUNT }, (_, index) => ({ radius: FIRST_RADIUS + index * RING_GAP, opacity: 1 - index / (RING_COUNT + 1) }));

export function RingsPattern({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      aria-hidden="true"
      data-rings-pattern
      viewBox="0 0 960 640"
      preserveAspectRatio="xMidYMin slice"
      className={cn("home-grid-fade pointer-events-none absolute inset-0 h-full w-full stroke-foreground/15 dark:stroke-foreground/[0.07]", className)}
    >
      {RINGS.map((ring) => (
        <circle
          key={ring.radius}
          cx={480}
          cy={40}
          r={ring.radius}
          fill="none"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          opacity={ring.opacity}
        />
      ))}
    </svg>
  );
}
