import { useId } from "react";
import { cn } from "@/lib/utils";

// Render inside a `relative` parent; mask via className for a gradient fade.
export function DotPattern({
  width = 24,
  height = 24,
  radius = 1,
  x = 0,
  y = 0,
  className,
}: {
  width?: number;
  height?: number;
  radius?: number;
  x?: number;
  y?: number;
  className?: string;
}) {
  const id = useId().replace(/[:]/g, "");
  return (
    <svg
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 h-full w-full fill-gray-400/70", className)}
    >
      <defs>
        <pattern id={id} width={width} height={height} patternUnits="userSpaceOnUse" x={x} y={y}>
          <circle cx={width / 2} cy={height / 2} r={radius} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" strokeWidth={0} fill={`url(#${id})`} />
    </svg>
  );
}
