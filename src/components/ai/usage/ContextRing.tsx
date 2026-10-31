import { cn } from "@/lib/utils";
import type { UsageSnapshot } from "./types";
import { contextFraction, USAGE_TONE_TEXT, usageTone } from "./usage-tone";

const RADIUS = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ContextRing({
  snapshot,
  className,
}: Readonly<{ snapshot: UsageSnapshot; className?: string }>) {
  const fraction = contextFraction(snapshot);
  const tone = fraction === null ? "normal" : usageTone(fraction);
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      data-testid="ai-context-ring"
      data-tone={tone}
      data-state={fraction === null ? "unknown" : "known"}
      className={cn("size-4 shrink-0 -rotate-90", USAGE_TONE_TEXT[tone], className)}
    >
      <circle
        cx="8"
        cy="8"
        r={RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="opacity-25"
      />
      {fraction !== null && fraction > 0 && (
        <circle
          cx="8"
          cy="8"
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${CIRCUMFERENCE * fraction} ${CIRCUMFERENCE}`}
        />
      )}
    </svg>
  );
}
