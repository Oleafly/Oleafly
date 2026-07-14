import { memo } from "react";
import { cn } from "@/lib/utils";

function band(score: number): { stroke: string; text: string } {
  if (score >= 85) return { stroke: "stroke-emerald-500", text: "text-emerald-500" };
  if (score >= 60) return { stroke: "stroke-amber-500", text: "text-amber-500" };
  return { stroke: "stroke-red-500", text: "text-red-500" };
}

export const ScoreRing = memo(function ScoreRing({ label, score }: { label: string; score: number }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, score)) / 100) * circ;
  const { stroke, text } = band(score);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative size-[68px]">
        <svg viewBox="0 0 68 68" className="size-full -rotate-90" role="img" aria-label={`${label} readiness ${score} out of 100`}>
          <circle cx="34" cy="34" r={r} className="fill-none stroke-border" strokeWidth="6" />
          <circle
            cx="34"
            cy="34"
            r={r}
            className={cn("fill-none transition-all", stroke)}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ}`}
          />
        </svg>
        <div className={cn("absolute inset-0 flex items-center justify-center text-lg font-semibold tabular-nums", text)}>
          {score}
        </div>
      </div>
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
});
